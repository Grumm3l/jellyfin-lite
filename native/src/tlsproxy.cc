// TLS 1.2 proxy for Samsung Tizen 2.3 TVs (NaCl, Pepper 37).
// The TV's web engine only speaks TLS 1.0; this module does TLS 1.2 with
// mbedTLS over Pepper TCP sockets. Messages from JavaScript:
//   "proxy <localport> <host> <port> [fast] [seerr] [plain]"
//        http://127.0.0.1:<localport>/... -> https://<host>:<port>/... (XHR, <img>,
//        AVPlay); "fast" = buffered I/O, "plain" = the server speaks plain HTTP
//   "cookies <localport> <a=1; b=2>"   restore a seerr-mode cookie jar
// The proxy also serves the book reader: GET /__book/... (see HandleBook).
// All socket work runs on background threads with blocking Pepper calls.

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <string>
#include <map>
#include <vector>

#include <irt.h>

#include "ppapi/c/ppb_host_resolver.h"
#include "ppapi/c/ppb_net_address.h"
#include "ppapi/cpp/completion_callback.h"
#include "ppapi/cpp/host_resolver.h"
#include "ppapi/cpp/instance.h"
#include "ppapi/cpp/message_loop.h"
#include "ppapi/cpp/module.h"
#include "ppapi/cpp/net_address.h"
#include "ppapi/cpp/tcp_socket.h"
#include "ppapi/cpp/var.h"
#include <sys/stat.h>

#include "mbedtls/cipher.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/error.h"
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"

#include "book.hpp"
#include "ca_bundle.h"
#include "pdfdoc.hpp"

namespace book {
std::string RarExtract(const std::string& archive, std::string* out);  // rarmini.cpp
}  // kCaPem: trusted roots (ca_bundle.h, generated from native/ca by nix/native.nix)

namespace {

pp::Instance* g_instance = NULL;
mbedtls_x509_crt g_ca;
struct nacl_irt_random g_random;

// Last TLS session per host: later connections resume it and skip the full
// ECDHE/RSA handshake (every proxied request opens its own connection).
pthread_mutex_t g_session_mu = PTHREAD_MUTEX_INITIALIZER;
mbedtls_ssl_session g_session;
std::string g_session_host;
bool g_session_valid = false;

void Post(const std::string& msg) {
  if (g_instance) g_instance->PostMessage(pp::Var(msg));
}

std::string MbedError(int code) {
  char buf[160];
  mbedtls_strerror(code, buf, sizeof(buf));
  char out[220];
  snprintf(out, sizeof(out), "-0x%04x %s", -code, buf);
  return out;
}

int Entropy(void*, unsigned char* out, size_t len) {
  size_t done = 0;
  while (done < len) {
    size_t n = 0;
    if (g_random.get_random_bytes(out + done, len - done, &n) != 0 || n == 0)
      return MBEDTLS_ERR_CTR_DRBG_ENTROPY_SOURCE_FAILED;
    done += n;
  }
  return 0;
}

double NowMs() {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0;
}

// Socket used as the mbedTLS transport. "buffered" reads up to 64 KB per
// Pepper call instead of mbedTLS's 5-byte header + body reads; every Pepper
// call is a round trip to the browser process.
struct TlsSocket {
  pp::TCPSocket sock;
  bool buffered;
  std::vector<char> buf;
  size_t pos, len;
  int reads;
  TlsSocket() : buffered(false), pos(0), len(0), reads(0) {}
  size_t Pending() const { return len - pos; }
};

int BioSend(void* ctx, const unsigned char* buf, size_t len) {
  TlsSocket* s = static_cast<TlsSocket*>(ctx);
  int32_t r = s->sock.Write(reinterpret_cast<const char*>(buf),
                            static_cast<int32_t>(len), pp::BlockUntilComplete());
  return r < 0 ? MBEDTLS_ERR_NET_SEND_FAILED : r;
}

int BioRecv(void* ctx, unsigned char* buf, size_t len) {
  TlsSocket* s = static_cast<TlsSocket*>(ctx);
  if (!s->buffered) {
    s->reads++;
    int32_t r = s->sock.Read(reinterpret_cast<char*>(buf), static_cast<int32_t>(len),
                             pp::BlockUntilComplete());
    return r < 0 ? MBEDTLS_ERR_NET_RECV_FAILED : r;
  }
  if (s->pos == s->len) {
    if (s->buf.empty()) s->buf.resize(65536);
    s->reads++;
    int32_t r = s->sock.Read(&s->buf[0], static_cast<int32_t>(s->buf.size()), pp::BlockUntilComplete());
    if (r < 0) return MBEDTLS_ERR_NET_RECV_FAILED;
    if (r == 0) return 0;
    s->pos = 0;
    s->len = static_cast<size_t>(r);
  }
  size_t n = s->len - s->pos;
  if (n > len) n = len;
  memcpy(buf, &s->buf[s->pos], n);
  s->pos += n;
  return static_cast<int>(n);
}

bool WriteAll(pp::TCPSocket* s, const char* buf, int32_t len) {
  while (len > 0) {
    int32_t r = s->Write(buf, len, pp::BlockUntilComplete());
    if (r <= 0) return false;
    buf += r;
    len -= r;
  }
  return true;
}

// Resolve + connect a plain TCP socket (must run on a thread with a loop).
std::string Connect(pp::TCPSocket* sock, const std::string& host, uint16_t port) {
  pp::HostResolver resolver(g_instance);
  PP_HostResolver_Hint hint = { PP_NETADDRESS_FAMILY_UNSPECIFIED, 0 };
  int32_t r = resolver.Resolve(host.c_str(), port, hint, pp::BlockUntilComplete());
  if (r != PP_OK) {
    char e[64];
    snprintf(e, sizeof(e), "DNS failed (%d)", r);
    return e;
  }
  uint32_t count = resolver.GetNetAddressCount();
  r = PP_ERROR_FAILED;
  for (uint32_t i = 0; i < count && r != PP_OK; i++) {
    *sock = pp::TCPSocket(g_instance);
    r = sock->Connect(resolver.GetNetAddress(i), pp::BlockUntilComplete());
  }
  if (r != PP_OK) {
    char e[64];
    snprintf(e, sizeof(e), "connect failed (%d, %u addresses)", r, count);
    return e;
  }
  return "";
}

// One TLS client connection (or a plain TCP one for http:// servers).
class TlsConn {
 public:
  TlsConn() : plain_(false) {
    mbedtls_ssl_init(&ssl_);
    mbedtls_ssl_config_init(&conf_);
    mbedtls_ctr_drbg_init(&drbg_);
    suites_[0] = suites_[1] = 0;
  }
  ~TlsConn() {
    mbedtls_ssl_free(&ssl_);
    mbedtls_ssl_config_free(&conf_);
    mbedtls_ctr_drbg_free(&drbg_);
    io_.sock.Close();
  }

  // suite: 0 = server's choice, else one MBEDTLS_TLS_* ciphersuite id
  std::string Open(const std::string& host, uint16_t port, int suite = 0, bool buffered = false,
                   bool plain = false) {
    io_.buffered = buffered;
    std::string err = Connect(&io_.sock, host, port);
    if (!err.empty()) return err;
    plain_ = plain;
    if (plain) return "";
    const char* pers = "jf-tls-proxy";
    int r = mbedtls_ctr_drbg_seed(&drbg_, Entropy, NULL,
                                  reinterpret_cast<const unsigned char*>(pers), strlen(pers));
    if (r) return "rng: " + MbedError(r);
    r = mbedtls_ssl_config_defaults(&conf_, MBEDTLS_SSL_IS_CLIENT,
                                    MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT);
    if (r) return "config: " + MbedError(r);
    mbedtls_ssl_conf_min_version(&conf_, MBEDTLS_SSL_MAJOR_VERSION_3, MBEDTLS_SSL_MINOR_VERSION_3);
    mbedtls_ssl_conf_authmode(&conf_, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&conf_, &g_ca, NULL);
    mbedtls_ssl_conf_rng(&conf_, mbedtls_ctr_drbg_random, &drbg_);
    if (suite) {
      suites_[0] = suite;
      mbedtls_ssl_conf_ciphersuites(&conf_, suites_);
    }
    r = mbedtls_ssl_setup(&ssl_, &conf_);
    if (r) return "setup: " + MbedError(r);
    mbedtls_ssl_set_hostname(&ssl_, host.c_str());
    mbedtls_ssl_set_bio(&ssl_, &io_, BioSend, BioRecv, NULL);
    pthread_mutex_lock(&g_session_mu);
    if (g_session_valid && g_session_host == host) mbedtls_ssl_set_session(&ssl_, &g_session);
    pthread_mutex_unlock(&g_session_mu);
    while ((r = mbedtls_ssl_handshake(&ssl_)) != 0) {
      if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
      std::string e = "handshake: " + MbedError(r);
      uint32_t flags = mbedtls_ssl_get_verify_result(&ssl_);
      if (flags) {
        char vbuf[256];
        mbedtls_x509_crt_verify_info(vbuf, sizeof(vbuf), "", flags);
        e += " | verify: ";
        e += vbuf;
      }
      return e;
    }
    pthread_mutex_lock(&g_session_mu);
    mbedtls_ssl_session_free(&g_session);
    mbedtls_ssl_session_init(&g_session);
    g_session_valid = mbedtls_ssl_get_session(&ssl_, &g_session) == 0;
    g_session_host = host;
    pthread_mutex_unlock(&g_session_mu);
    return "";
  }

  bool Send(const std::string& data) {
    size_t off = 0;
    while (plain_ && off < data.size()) {
      int r = BioSend(&io_, reinterpret_cast<const unsigned char*>(data.data()) + off, data.size() - off);
      if (r <= 0) return false;
      off += r;
    }
    while (off < data.size()) {
      int r = mbedtls_ssl_write(&ssl_, reinterpret_cast<const unsigned char*>(data.data()) + off,
                                data.size() - off);
      if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
      if (r <= 0) return false;
      off += r;
    }
    return true;
  }

  // >0 bytes, 0 = closed, <0 = error
  int Recv(char* buf, size_t len) {
    if (plain_) {
      int r = BioRecv(&io_, reinterpret_cast<unsigned char*>(buf), len);
      return r < 0 ? -1 : r;
    }
    for (;;) {
      int r = mbedtls_ssl_read(&ssl_, reinterpret_cast<unsigned char*>(buf), len);
      if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
      if (r == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) return 0;
      return r;
    }
  }

  // decrypted or raw bytes that can be read without blocking on the socket
  size_t Pending() { return (plain_ ? 0 : mbedtls_ssl_get_bytes_avail(&ssl_)) + io_.Pending(); }
  int Reads() const { return io_.reads; }

  std::string Describe() {
    if (plain_) return "plain HTTP";
    return std::string(mbedtls_ssl_get_version(&ssl_)) + " " + mbedtls_ssl_get_ciphersuite(&ssl_);
  }

 private:
  TlsSocket io_;
  bool plain_;
  int suites_[2];
  mbedtls_ssl_context ssl_;
  mbedtls_ssl_config conf_;
  mbedtls_ctr_drbg_context drbg_;
};

void AttachLoop() {
  pp::MessageLoop loop(g_instance);
  loop.AttachToCurrentThread();
}

// ---------- "proxy" ----------

// "seerr" mode is for web apps behind CSRF protection and Secure/SameSite
// cookies (Seerr): the proxy keeps the cookies itself, sends the
// XSRF-TOKEN cookie back as X-XSRF-TOKEN, answers CORS preflights locally and
// reports cookie changes to JavaScript ("cookies|<port>|a=1; b=2") so the
// session survives an app restart ("cookies <port> a=1; b=2" restores it).
struct ProxyConfig {
  std::string host;
  uint16_t upstream_port;
  uint16_t local_port;
  bool fast;   // buffered TLS reads + 64 KB writes to the client
  bool seerr;  // cookie jar + CSRF header + local CORS
  bool plain;  // upstream is plain HTTP (books for http:// servers)
  pthread_mutex_t mu;
  std::map<std::string, std::string> jar;
};

std::vector<ProxyConfig*> g_proxies;
pthread_mutex_t g_proxies_mu = PTHREAD_MUTEX_INITIALIZER;

std::string JarString(ProxyConfig* cfg) {
  std::string s;
  for (std::map<std::string, std::string>::const_iterator it = cfg->jar.begin(); it != cfg->jar.end(); ++it) {
    if (!s.empty()) s += "; ";
    s += it->first + "=" + it->second;
  }
  return s;
}

std::string Trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t");
  if (a == std::string::npos) return "";
  size_t b = s.find_last_not_of(" \t");
  return s.substr(a, b - a + 1);
}

// "a=1; b=2" -> jar (replaces the jar)
void SetJar(ProxyConfig* cfg, const std::string& cookies) {
  pthread_mutex_lock(&cfg->mu);
  cfg->jar.clear();
  size_t pos = 0;
  while (pos < cookies.size()) {
    size_t end = cookies.find(';', pos);
    if (end == std::string::npos) end = cookies.size();
    std::string part = Trim(cookies.substr(pos, end - pos));
    size_t eq = part.find('=');
    if (eq != std::string::npos && eq > 0) cfg->jar[part.substr(0, eq)] = part.substr(eq + 1);
    pos = end + 1;
  }
  pthread_mutex_unlock(&cfg->mu);
}

struct ClientJob {
  PP_Resource sock;
  ProxyConfig* cfg;
};

std::string Lower(std::string s) {
  for (size_t i = 0; i < s.size(); i++) s[i] = tolower(s[i]);
  return s;
}

void Reply(pp::TCPSocket* client, const char* status, const std::string& text) {
  std::string r = std::string("HTTP/1.1 ") + status +
                  "\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\n"
                  "Connection: close\r\n\r\n" + text;
  WriteAll(client, r.data(), static_cast<int32_t>(r.size()));
}

// seerr mode: take Set-Cookie into the jar, add CORS; returns the new head
std::string RewriteResponseHead(ProxyConfig* cfg, const std::string& head) {
  std::string out;
  size_t pos = 0;
  bool first = true;
  bool changed = false;
  pthread_mutex_lock(&cfg->mu);
  while (pos < head.size()) {
    size_t eol = head.find("\r\n", pos);
    if (eol == std::string::npos) eol = head.size();
    std::string line = head.substr(pos, eol - pos);
    pos = eol + 2;
    if (line.empty()) continue;
    if (first) { out += line + "\r\n"; first = false; continue; }
    std::string key = Lower(Trim(line.substr(0, line.find(':'))));
    if (key == "set-cookie") {
      std::string v = Trim(line.substr(line.find(':') + 1));
      std::string pair = v.substr(0, v.find(';'));
      size_t eq = pair.find('=');
      if (eq != std::string::npos && eq > 0) {
        std::string name = Trim(pair.substr(0, eq));
        std::string value = Trim(pair.substr(eq + 1));
        bool expired = Lower(v).find("expires=thu, 01 jan 1970") != std::string::npos ||
                       Lower(v).find("max-age=0") != std::string::npos;
        if (value.empty() || expired) {
          if (cfg->jar.erase(name)) changed = true;
        } else if (cfg->jar[name] != value) {
          cfg->jar[name] = value;
          changed = true;
        }
      }
      continue;
    }
    if (key.find("access-control-") == 0) continue;  // replaced by our own CORS header
    out += line + "\r\n";
  }
  std::string jar = JarString(cfg);
  pthread_mutex_unlock(&cfg->mu);
  out += "Access-Control-Allow-Origin: *\r\n\r\n";
  if (changed) {
    char port[16];
    snprintf(port, sizeof(port), "%u", cfg->local_port);
    Post(std::string("cookies|") + port + "|" + jar);
  }
  return out;
}

// ---------- books: comic/EPUB pages from archives on the server ----------
//   GET /__book/<itemId>/info?token=T        {"format":"zip","pages":N,"entries":M}
//   GET /__book/<itemId>/page/<n>?token=T    page image n (0-based, reading order)
//   GET /__book/<itemId>/file/<path>?token=T any archive entry (EPUB)
// Archives are read with HTTP range requests over one keep-alive connection;
// see book.cpp for ZIP/RAR4/RAR5 indexing and extraction.

// HTTP/1.1 keep-alive client over one TLS connection
class HttpConn {
 public:
  HttpConn(const std::string& host, uint16_t port, bool plain)
      : host_(host), port_(port), plain_(plain), conn_(NULL) {}
  ~HttpConn() { delete conn_; }

  // GET with extra headers; fills status, head and body
  std::string Get(const std::string& path, const std::string& headers, int* status,
                  std::string* head, std::string* body) {
    for (int attempt = 0; attempt < 2; attempt++) {
      if (!conn_) {
        conn_ = new TlsConn();
        std::string err = conn_->Open(host_, port_, 0, true, plain_);
        if (!err.empty()) { delete conn_; conn_ = NULL; return err; }
        buf_.clear();
      }
      std::string req = "GET " + path + " HTTP/1.1\r\nHost: " + host_ + "\r\n" + headers +
                        "Connection: keep-alive\r\n\r\n";
      std::string err;
      if (!conn_->Send(req)) err = "send failed";
      else err = ReadResponse(status, head, body);
      if (err.empty()) return "";
      delete conn_;  // stale keep-alive connection: reconnect once
      conn_ = NULL;
      if (attempt == 1) return err;
    }
    return "unreachable";
  }

 private:
  bool Fill() {
    char tmp[65536];
    int n = conn_->Recv(tmp, sizeof(tmp));
    if (n <= 0) return false;
    buf_.append(tmp, n);
    return true;
  }

  std::string ReadResponse(int* status, std::string* head, std::string* body) {
    size_t end;
    while ((end = buf_.find("\r\n\r\n")) == std::string::npos) {
      if (buf_.size() > 65536 || !Fill()) return "no response";
    }
    *head = buf_.substr(0, end + 2);
    buf_.erase(0, end + 4);
    *status = atoi(head->c_str() + head->find(' ') + 1);
    std::string lh = head->c_str();
    for (size_t i = 0; i < lh.size(); i++) lh[i] = static_cast<char>(tolower(lh[i]));
    size_t cl = lh.find("\r\ncontent-length:");
    bool keep = lh.find("\r\nconnection: close") == std::string::npos;
    if (cl == std::string::npos) {
      while (Fill()) {}  // no length: read until the server closes
      body->swap(buf_);
      buf_.clear();
      delete conn_;
      conn_ = NULL;
      return "";
    }
    size_t len = static_cast<size_t>(atoll(lh.c_str() + cl + 17));
    while (buf_.size() < len) {
      if (!Fill()) return "connection closed";
    }
    body->assign(buf_, 0, len);
    buf_.erase(0, len);
    if (!keep) { delete conn_; conn_ = NULL; }
    return "";
  }

  std::string host_;
  uint16_t port_;
  bool plain_;
  TlsConn* conn_;
  std::string buf_;
};

class HttpRangeSource : public book::RangeSource {
 public:
  HttpRangeSource(const std::string& host, uint16_t port, bool plain, const std::string& item,
                  const std::string& token)
      : http_(host, port, plain), item_(item), token_(token), size_(-1) {}

  int64_t Size() {
    if (size_ < 0) {
      std::string tmp;
      Fetch(0, 1, &tmp);
    }
    return size_ < 0 ? 0 : size_;
  }

  std::string Read(int64_t off, int64_t len, std::string* out) {
    if (size_ >= 0 && off + len > size_) len = size_ - off;
    return Fetch(off, len, out);
  }

 private:
  std::string Fetch(int64_t off, int64_t len, std::string* out) {
    char hdr[256];
    snprintf(hdr, sizeof(hdr), "Range: bytes=%lld-%lld\r\n", static_cast<long long>(off),
             static_cast<long long>(off + len - 1));
    std::string headers = std::string("Authorization: MediaBrowser Token=\"") + token_ + "\"\r\n" + hdr;
    int status = 0;
    std::string head;
    std::string err = http_.Get("/Items/" + item_ + "/Download", headers, &status, &head, out);
    if (!err.empty()) return err;
    if (status == 403) return "Download-Berechtigung fehlt (403)";
    if (status != 206 && !(status == 200 && off == 0)) {
      char e[48];
      snprintf(e, sizeof(e), "HTTP %d", status);
      return e;
    }
    std::string lh = head;
    for (size_t i = 0; i < lh.size(); i++) lh[i] = static_cast<char>(tolower(lh[i]));
    size_t cr = lh.find("content-range:");
    if (cr != std::string::npos) {
      size_t slash = lh.find('/', cr);
      if (slash != std::string::npos) size_ = atoll(lh.c_str() + slash + 1);
    } else if (status == 200) {
      size_ = static_cast<int64_t>(out->size());
    }
    if (status == 200 && static_cast<int64_t>(out->size()) > len) out->resize(static_cast<size_t>(len));
    return "";
  }

  HttpConn http_;
  std::string item_, token_;
  int64_t size_;
};

struct BookSlot {
  std::string id;
  book::Archive archive;
  book::PdfDoc* pdf;  // set instead of the archive for PDF files
  HttpRangeSource* src;
  pthread_mutex_t mu;
  std::string error;
  bool opened;
  double used;
};

pthread_mutex_t g_books_mu = PTHREAD_MUTEX_INITIALIZER;
std::vector<BookSlot*> g_books;

// returns the slot locked (caller unlocks slot->mu)
BookSlot* GetBook(const std::string& id, const std::string& token, const ProxyConfig* cfg) {
  pthread_mutex_lock(&g_books_mu);
  BookSlot* slot = NULL;
  for (size_t i = 0; i < g_books.size(); i++) if (g_books[i]->id == id) slot = g_books[i];
  if (!slot) {
    if (g_books.size() >= 3) {  // keep the three most recent books
      size_t oldest = 0;
      for (size_t i = 1; i < g_books.size(); i++) if (g_books[i]->used < g_books[oldest]->used) oldest = i;
      BookSlot* old = g_books[oldest];
      pthread_mutex_lock(&old->mu);  // wait until nobody reads from it
      pthread_mutex_unlock(&old->mu);
      g_books.erase(g_books.begin() + oldest);
      delete old->pdf;
      delete old->src;
      delete old;
    }
    slot = new BookSlot();
    slot->id = id;
    slot->src = new HttpRangeSource(cfg->host, cfg->upstream_port, cfg->plain, id, token);
    pthread_mutex_init(&slot->mu, NULL);
    slot->opened = false;
    slot->pdf = NULL;
    slot->archive.set_rar_extractor(book::RarExtract);
    g_books.push_back(slot);
  }
  slot->used = NowMs();
  pthread_mutex_unlock(&g_books_mu);
  pthread_mutex_lock(&slot->mu);
  if (!slot->opened) {
    std::string head;
    slot->error = slot->src->Read(0, 8, &head);
    if (slot->error.empty() && book::PdfDoc::IsPdf(head)) {
      delete slot->pdf;
      slot->pdf = new book::PdfDoc();
      slot->error = slot->pdf->Open(slot->src);
    } else if (slot->error.empty()) {
      slot->error = slot->archive.Open(slot->src);
    }
    slot->opened = true;
  }
  return slot;
}

std::string UrlDecode(const std::string& s) {
  std::string out;
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '%' && i + 2 < s.size()) {
      out.push_back(static_cast<char>(strtol(s.substr(i + 1, 2).c_str(), NULL, 16)));
      i += 2;
    } else {
      out.push_back(s[i] == '+' ? ' ' : s[i]);
    }
  }
  return out;
}

std::string MimeType(const std::string& name) {
  std::string n = Lower(name);
  size_t dot = n.rfind('.');
  std::string ext = dot == std::string::npos ? "" : n.substr(dot + 1);
  if (ext == "jpg" || ext == "jpeg") return "image/jpeg";
  if (ext == "png" || ext == "gif" || ext == "webp" || ext == "bmp") return "image/" + ext;
  if (ext == "svg") return "image/svg+xml";
  if (ext == "xhtml" || ext == "xht") return "application/xhtml+xml; charset=utf-8";
  if (ext == "html" || ext == "htm") return "text/html; charset=utf-8";
  if (ext == "css") return "text/css; charset=utf-8";
  if (ext == "xml" || ext == "opf" || ext == "ncx") return "application/xml; charset=utf-8";
  return "application/octet-stream";
}

void SendBody(pp::TCPSocket* client, int status, const std::string& type, const std::string& body) {
  char head[512];
  snprintf(head, sizeof(head), "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\n"
           "Access-Control-Allow-Origin: *\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n",
           status, status == 200 ? "OK" : "Error", type.c_str(), static_cast<unsigned>(body.size()));
  std::string out = std::string(head) + body;
  WriteAll(client, out.data(), static_cast<int32_t>(out.size()));
}

std::string JsonEscape(const std::string& s) {
  std::string o;
  for (size_t i = 0; i < s.size(); i++) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    if (c == '"' || c == '\\') { o.push_back('\\'); o.push_back(static_cast<char>(c)); }
    else if (c < 0x20) { char u[8]; snprintf(u, sizeof(u), "\\u%04x", c); o += u; }
    else o.push_back(static_cast<char>(c));
  }
  return o;
}

// target: "/__book/<id>/<what>[/<arg>]?token=T"
void HandleBook(pp::TCPSocket* client, const std::string& target, const ProxyConfig* cfg) {
  std::string path = target, query;
  size_t q = target.find('?');
  if (q != std::string::npos) { path = target.substr(0, q); query = target.substr(q + 1); }
  std::string token;
  size_t t = query.find("token=");
  if (t != std::string::npos) token = query.substr(t + 6, query.find('&', t) - (t + 6));
  std::string rest = path.substr(8);  // after "/__book/"
  size_t s1 = rest.find('/');
  if (s1 == std::string::npos || token.empty()) { SendBody(client, 400, "text/plain", "bad request"); return; }
  std::string id = rest.substr(0, s1);
  std::string what = rest.substr(s1 + 1), arg;
  size_t s2 = what.find('/');
  if (s2 != std::string::npos) { arg = UrlDecode(what.substr(s2 + 1)); what = what.substr(0, s2); }
  for (size_t i = 0; i < id.size(); i++) {
    if (!isalnum(static_cast<unsigned char>(id[i])) && id[i] != '-') { SendBody(client, 400, "text/plain", "bad id"); return; }
  }

  double t0 = NowMs();
  BookSlot* slot = GetBook(id, token, cfg);
  std::string err = slot->error;
  std::string body, type = "application/json";
  int status = 200;
  if (err.empty() && slot->pdf) {
    // PDF: pages are rendered by MuPDF (pdfdoc.cpp)
    book::PdfDoc* pdf = slot->pdf;
    if (what == "info") {
      char j[160];
      snprintf(j, sizeof(j), "{\"format\":\"pdf\",\"epub\":false,\"pages\":%d,\"requests\":%d,\"ms\":%.0f}",
               pdf->pages(), pdf->requests(), NowMs() - t0);
      body = j;
    } else if (what == "page") {
      int width = 1280;
      size_t wpos = query.find("width=");
      if (wpos != std::string::npos) width = atoi(query.c_str() + wpos + 6);
      if (width < 200 || width > 2560) width = 1280;
      err = pdf->RenderJpeg(atoi(arg.c_str()), width, &body);
      type = "image/jpeg";
    } else {
      status = 404;
      err = "not available for PDF";
    }
  } else if (err.empty()) {
    const book::Archive& a = slot->archive;
    if (what == "info") {
      char j[256];
      snprintf(j, sizeof(j),
               "{\"format\":\"%s\",\"epub\":%s,\"pages\":%u,\"entries\":%u,\"requests\":%d,\"ms\":%.0f}",
               a.format().c_str(), a.Find("META-INF/container.xml") >= 0 ? "true" : "false",
               static_cast<unsigned>(a.pages().size()),
               static_cast<unsigned>(a.entries().size()), a.requests(), NowMs() - t0);
      body = j;
    } else if (what == "page") {
      int n = atoi(arg.c_str());
      if (n < 0 || n >= static_cast<int>(a.pages().size())) { status = 404; err = "no such page"; }
      else {
        int idx = a.pages()[n];
        err = slot->archive.ReadEntry(slot->src, idx, &body);
        type = MimeType(a.entries()[idx].name);
      }
    } else if (what == "file") {
      int idx = a.Find(arg);
      if (idx < 0) { status = 404; err = "not found: " + arg; }
      else {
        err = slot->archive.ReadEntry(slot->src, idx, &body);
        type = MimeType(arg);
      }
    } else {
      status = 404;
      err = "unknown request";
    }
  } else {
    slot->opened = false;  // retry opening next time (e.g. network hiccup)
  }
  pthread_mutex_unlock(&slot->mu);
  if (!err.empty()) {
    if (status == 200) status = 502;
    SendBody(client, status, "application/json", "{\"error\":\"" + JsonEscape(err) + "\"}");
    return;
  }
  SendBody(client, 200, type, body);
}

void* ClientThread(void* arg) {
  ClientJob* job = static_cast<ClientJob*>(arg);
  AttachLoop();
  pp::TCPSocket client(pp::PASS_REF, job->sock);
  ProxyConfig* cfg = job->cfg;
  delete job;

  // read the request head
  std::string head;
  char buf[16384];
  size_t end = std::string::npos;
  while (end == std::string::npos && head.size() < 65536) {
    int32_t n = client.Read(buf, sizeof(buf), pp::BlockUntilComplete());
    if (n <= 0) { client.Close(); return NULL; }
    head.append(buf, n);
    end = head.find("\r\n\r\n");
  }
  if (end == std::string::npos) { Reply(&client, "431 Too Large", ""); client.Close(); return NULL; }
  std::string rest = head.substr(end + 4);
  head.resize(end + 2);

  if (!cfg->seerr && head.compare(0, 12, "GET /__book/") == 0) {
    HandleBook(&client, head.substr(4, head.find(' ', 4) - 4), cfg);
    client.Close();
    return NULL;
  }

  if (cfg->seerr && head.compare(0, 8, "OPTIONS ") == 0) {
    // CORS preflight: answered here, the browser never sends cookies anyway
    std::string r = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\n"
                    "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
                    "Access-Control-Allow-Headers: Content-Type, Accept\r\n"
                    "Access-Control-Max-Age: 600\r\nConnection: close\r\n\r\n";
    WriteAll(&client, r.data(), static_cast<int32_t>(r.size()));
    client.Close();
    return NULL;
  }

  // rewrite headers: our Host, one request per connection
  std::string out;
  size_t pos = 0;
  long content_length = 0;
  bool first = true;
  while (pos < head.size()) {
    size_t eol = head.find("\r\n", pos);
    std::string line = head.substr(pos, eol - pos);
    pos = eol + 2;
    if (first) { out += line + "\r\n"; first = false; continue; }
    std::string key = Lower(line.substr(0, line.find(':')));
    if (key == "host" || key == "connection" || key == "proxy-connection" ||
        key == "keep-alive") continue;  // Origin stays: Jellyfin answers CORS only with it
    if (cfg->seerr && (key == "cookie" || key == "origin" || key == "referer" ||
                       key == "x-xsrf-token")) continue;
    if (key == "content-length") content_length = atol(line.substr(line.find(':') + 1).c_str());
    out += line + "\r\n";
  }
  char hostline[300];
  if (cfg->upstream_port == 443) snprintf(hostline, sizeof(hostline), "Host: %s\r\n", cfg->host.c_str());
  else snprintf(hostline, sizeof(hostline), "Host: %s:%u\r\n", cfg->host.c_str(), cfg->upstream_port);
  out += hostline;
  if (cfg->seerr) {
    pthread_mutex_lock(&cfg->mu);
    std::string jar = JarString(cfg);
    std::map<std::string, std::string>::const_iterator x = cfg->jar.find("XSRF-TOKEN");
    std::string token = x == cfg->jar.end() ? "" : x->second;
    pthread_mutex_unlock(&cfg->mu);
    if (!jar.empty()) out += "Cookie: " + jar + "\r\n";
    if (!token.empty()) out += "X-XSRF-TOKEN: " + token + "\r\n";
  }
  out += "Connection: close\r\n\r\n";

  TlsConn up;
  std::string err = up.Open(cfg->host, cfg->upstream_port, 0, cfg->fast, cfg->plain);
  if (!err.empty()) {
    Reply(&client, "502 Bad Gateway", err);
    client.Close();
    return NULL;
  }
  bool ok = up.Send(out);
  // forward a request body (POST) if any
  long sent = 0;
  if (ok && content_length > 0) {
    if (!rest.empty()) { ok = up.Send(rest); sent = static_cast<long>(rest.size()); }
    while (ok && sent < content_length) {
      int32_t n = client.Read(buf, sizeof(buf), pp::BlockUntilComplete());
      if (n <= 0) { ok = false; break; }
      ok = up.Send(std::string(buf, n));
      sent += n;
    }
  }
  // seerr mode: the response head is rewritten (cookies, CORS) before streaming
  std::string pending;
  if (ok && cfg->seerr) {
    std::string rhead;
    size_t rend = std::string::npos;
    while (rend == std::string::npos && rhead.size() < 65536) {
      int n = up.Recv(buf, sizeof(buf));
      if (n <= 0) break;
      rhead.append(buf, n);
      rend = rhead.find("\r\n\r\n");
    }
    if (rend == std::string::npos) {
      Reply(&client, "502 Bad Gateway", "bad response head");
      client.Close();
      return NULL;
    }
    pending = RewriteResponseHead(cfg, rhead.substr(0, rend + 2)) + rhead.substr(rend + 4);
  }
  // stream the response back
  while (ok) {
    int n = up.Recv(buf, sizeof(buf));
    if (n <= 0) break;
    if (!cfg->fast) {
      if (!pending.empty()) {
        if (!WriteAll(&client, pending.data(), static_cast<int32_t>(pending.size()))) break;
        pending.clear();
      }
      if (!WriteAll(&client, buf, n)) break;
      continue;
    }
    /* collect while more data is ready without waiting, then write 64 KB at once */
    pending.append(buf, n);
    if (pending.size() >= 65536 || up.Pending() == 0) {
      if (!WriteAll(&client, pending.data(), static_cast<int32_t>(pending.size()))) break;
      pending.clear();
    }
  }
  if (!pending.empty()) WriteAll(&client, pending.data(), static_cast<int32_t>(pending.size()));
  client.Close();
  return NULL;
}

void ProxyError(ProxyConfig* cfg, const char* what, int32_t r) {
  char e[96];
  snprintf(e, sizeof(e), "proxy-error|%u|%s failed (%d)", cfg->local_port, what, r);
  Post(e);
}

void* ListenThread(void* arg) {
  ProxyConfig* cfg = static_cast<ProxyConfig*>(arg);  // lives for the module lifetime
  AttachLoop();
  pp::TCPSocket listener(g_instance);
  PP_NetAddress_IPv4 a;
  a.port = static_cast<uint16_t>((cfg->local_port >> 8) | (cfg->local_port << 8));  // network order
  a.addr[0] = 127; a.addr[1] = 0; a.addr[2] = 0; a.addr[3] = 1;
  int32_t r = listener.Bind(pp::NetAddress(g_instance, a), pp::BlockUntilComplete());
  if (r != PP_OK) { ProxyError(cfg, "bind", r); return NULL; }
  r = listener.Listen(16, pp::BlockUntilComplete());
  if (r != PP_OK) { ProxyError(cfg, "listen", r); return NULL; }
  pthread_mutex_lock(&g_proxies_mu);
  g_proxies.push_back(cfg);
  pthread_mutex_unlock(&g_proxies_mu);
  char ready[64];
  snprintf(ready, sizeof(ready), "proxy-ready|%u", cfg->local_port);
  Post(ready);
  for (;;) {
    PP_Resource accepted = 0;
    pp::CompletionCallbackWithOutput<pp::TCPSocket> cb(&accepted);
    r = listener.Accept(cb);
    if (r != PP_OK) { ProxyError(cfg, "accept", r); return NULL; }
    ClientJob* job = new ClientJob();
    job->sock = accepted;
    job->cfg = cfg;
    pthread_t t;
    pthread_create(&t, NULL, ClientThread, job);
    pthread_detach(t);
  }
  return NULL;
}

std::string Word(const std::string& s, int idx) {
  size_t pos = 0;
  for (int i = 0; i < idx; i++) {
    pos = s.find(' ', pos);
    if (pos == std::string::npos) return "";
    pos++;
  }
  size_t end = s.find(' ', pos);
  return s.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
}

class TlsInstance : public pp::Instance {
 public:
  explicit TlsInstance(PP_Instance i) : pp::Instance(i) {}

  virtual bool Init(uint32_t, const char*[], const char*[]) {
    g_instance = this;
    if (nacl_interface_query(NACL_IRT_RANDOM_v0_1, &g_random, sizeof(g_random)) != sizeof(g_random)) {
      Post("init-error|no secure random source");
      return true;
    }
    mbedtls_x509_crt_init(&g_ca);
    mbedtls_ssl_session_init(&g_session);
    int r = mbedtls_x509_crt_parse(&g_ca, reinterpret_cast<const unsigned char*>(kCaPem),
                                   strlen(kCaPem) + 1);
    if (r < 0) Post("init-error|CA parse " + MbedError(r));
    else Post("init-ok|mbedTLS ready");
    return true;
  }

  virtual void HandleMessage(const pp::Var& msg) {
    if (!msg.is_string()) return;
    std::string m = msg.AsString();
    std::string cmd = Word(m, 0);
    pthread_t t;
    if (cmd == "cookies") {
      /* cookies <localport> <a=1; b=2>: restore a saved session (seerr proxies) */
      uint16_t port = static_cast<uint16_t>(atoi(Word(m, 1).c_str()));
      size_t start = m.find(' ', m.find(' ') + 1);
      std::string jar = start == std::string::npos ? "" : m.substr(start + 1);
      pthread_mutex_lock(&g_proxies_mu);
      for (size_t i = 0; i < g_proxies.size(); i++) {
        if (g_proxies[i]->local_port == port) SetJar(g_proxies[i], jar);
      }
      pthread_mutex_unlock(&g_proxies_mu);
    } else if (cmd == "proxy") {
      ProxyConfig* cfg = new ProxyConfig();
      cfg->local_port = static_cast<uint16_t>(atoi(Word(m, 1).c_str()));
      cfg->host = Word(m, 2);
      cfg->upstream_port = static_cast<uint16_t>(atoi(Word(m, 3).c_str()));
      cfg->fast = Word(m, 4) == "fast";
      cfg->seerr = Word(m, 5) == "seerr";
      cfg->plain = Word(m, 5) == "plain" || Word(m, 6) == "plain";
      pthread_mutex_init(&cfg->mu, NULL);
      pthread_create(&t, NULL, ListenThread, cfg);
      pthread_detach(t);
    }
  }
};

class TlsModule : public pp::Module {
 public:
  virtual pp::Instance* CreateInstance(PP_Instance i) { return new TlsInstance(i); }
};

}  // namespace

namespace pp {
Module* CreateModule() { return new TlsModule(); }
}  // namespace pp
