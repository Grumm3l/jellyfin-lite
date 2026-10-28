// PDF rendering with MuPDF. The file is never downloaded as a whole: MuPDF
// reads through a custom fz_stream that fetches 64 KB blocks with range
// requests and keeps the most recent blocks in a small cache.
#include "pdfdoc.hpp"

#include <string.h>
#include <time.h>

#include <list>
#include <map>

extern "C" {
#include "mupdf/fitz.h"
}

#ifdef __native_client__
// newlib has no timegm (MuPDF uses it for PDF dates): UTC struct tm -> time_t
extern "C" time_t timegm(struct tm* t) {
  int y = t->tm_year + 1900, m = t->tm_mon + 1;
  if (m <= 2) { y--; m += 12; }
  // days since 1970-01-01 (proleptic Gregorian calendar)
  long days = 365L * y + y / 4 - y / 100 + y / 400 + (153 * (m - 3) + 2) / 5 + t->tm_mday - 719469;
  return static_cast<time_t>(days * 86400L + t->tm_hour * 3600L + t->tm_min * 60L + t->tm_sec);
}

// nor realpath; MuPDF only needs it for file names, and PDFs are read from
// a stream here, so the path is returned unchanged
extern "C" char* realpath(const char* path, char* resolved) {
  if (!path) return NULL;
  if (!resolved) return strdup(path);
  strncpy(resolved, path, 4095);
  resolved[4095] = 0;
  return resolved;
}
#endif

namespace book {

namespace {

const int64_t kBlock = 65536;
const int64_t kReadAhead = 1 << 20;
const size_t kMaxBlocks = 128;  // 8 MB cache

}  // namespace

struct PdfState {
  fz_context* ctx;
  fz_document* doc;
  RangeSource* src;
  int64_t size;
  int64_t pos;  // offset of the next block MuPDF will ask for
  int requests;
  int64_t last_end;  // end of the last fetch (detects sequential reading)
  std::map<int64_t, std::string> blocks;
  std::list<int64_t> lru;  // most recent first
  std::string error;       // set before throwing out of the stream callbacks
  unsigned char buf[kBlock];
  // rendered pages: the reader asks again for preloaded pages and retries
  std::map<int64_t, std::string> jpegs;  // key: page * 10000 + width
  std::list<int64_t> jpeg_lru;

  // copies [pos, pos+want) into buf from cached/fetched blocks; returns bytes
  size_t Fill(int64_t at) {
    if (at >= size) return 0;
    int64_t base = at - at % kBlock;
    std::map<int64_t, std::string>::iterator it = blocks.find(base);
    if (it == blocks.end()) {
      // sequential reading (big images/fonts): fetch 1 MB at once
      int64_t want = base == last_end ? kReadAhead : kBlock;
      if (base + want > size) want = size - base;
      std::string data;
      requests++;
      error = src->Read(base, want, &data);
      if (!error.empty() || static_cast<int64_t>(data.size()) != want) {
        if (error.empty()) error = "short read";
        return static_cast<size_t>(-1);
      }
      last_end = base + want;
      for (int64_t b = 0; b < want; b += kBlock) {
        if (b && blocks.count(base + b)) continue;
        if (blocks.size() >= kMaxBlocks) {
          blocks.erase(lru.back());
          lru.pop_back();
        }
        int64_t len = b + kBlock > want ? want - b : kBlock;
        blocks[base + b] = data.substr(static_cast<size_t>(b), static_cast<size_t>(len));
        if (b) lru.push_front(base + b);
      }
      it = blocks.find(base);
    } else {
      lru.remove(base);
    }
    lru.push_front(base);
    size_t off = static_cast<size_t>(at - base);
    size_t n = it->second.size() - off;
    memcpy(buf, it->second.data() + off, n);
    return n;
  }
};

namespace {

int StreamNext(fz_context* ctx, fz_stream* stm, size_t max) {
  (void)max;
  PdfState* st = static_cast<PdfState*>(stm->state);
  size_t n = st->Fill(st->pos);
  if (n == static_cast<size_t>(-1)) fz_throw(ctx, FZ_ERROR_GENERIC, "read failed");
  if (n == 0) return EOF;
  stm->rp = st->buf;
  stm->wp = st->buf + n;
  st->pos += static_cast<int64_t>(n);
  stm->pos = st->pos;
  return *stm->rp++;
}

void StreamSeek(fz_context* ctx, fz_stream* stm, int64_t offset, int whence) {
  (void)ctx;
  PdfState* st = static_cast<PdfState*>(stm->state);
  int64_t cur = stm->pos - (stm->wp - stm->rp);
  int64_t target = whence == SEEK_END ? st->size + offset : whence == SEEK_CUR ? cur + offset : offset;
  if (target < 0) target = 0;
  if (target > st->size) target = st->size;
  st->pos = target;
  stm->pos = target;
  stm->rp = stm->wp = st->buf;
}

void StreamDrop(fz_context* ctx, void* state) {
  (void)ctx;
  (void)state;  // owned by PdfDoc
}

}  // namespace

PdfDoc::PdfDoc() : st_(new PdfState()), pages_(0) {
  st_->ctx = NULL;
  st_->doc = NULL;
  st_->src = NULL;
  st_->size = 0;
  st_->pos = 0;
  st_->requests = 0;
  st_->last_end = -1;
}

PdfDoc::~PdfDoc() {
  if (st_->ctx) {
    fz_drop_document(st_->ctx, st_->doc);
    fz_drop_context(st_->ctx);
  }
  delete st_;
}

int PdfDoc::requests() const { return st_->requests; }

std::string PdfDoc::Open(RangeSource* src) {
  st_->src = src;
  st_->size = src->Size();
  st_->ctx = fz_new_context(NULL, NULL, 32 << 20);
  if (!st_->ctx) return "pdf: no memory for MuPDF";
  fz_context* ctx = st_->ctx;
  fz_stream* volatile stm = NULL;
  std::string err;
  fz_try(ctx) {
    fz_register_document_handlers(ctx);
    stm = fz_new_stream(ctx, st_, StreamNext, StreamDrop);
    stm->seek = StreamSeek;
    st_->doc = fz_open_document_with_stream(ctx, "application/pdf", stm);
    if (fz_needs_password(ctx, st_->doc)) fz_throw(ctx, FZ_ERROR_GENERIC, "password protected");
    pages_ = fz_count_pages(ctx, st_->doc);
  }
  fz_always(ctx) {
    fz_drop_stream(ctx, stm);
  }
  fz_catch(ctx) {
    err = std::string("pdf: ") + fz_caught_message(ctx);
    if (!st_->error.empty()) err += " (" + st_->error + ")";
  }
  return err;
}

std::string PdfDoc::RenderJpeg(int n, int width, std::string* out) {
  if (!st_->doc || n < 0 || n >= pages_) return "pdf: no such page";
  int64_t key = static_cast<int64_t>(n) * 10000 + width;
  std::map<int64_t, std::string>::iterator hit = st_->jpegs.find(key);
  if (hit != st_->jpegs.end()) {
    *out = hit->second;
    st_->jpeg_lru.remove(key);
    st_->jpeg_lru.push_front(key);
    return "";
  }
  std::string err = Render(n, width, out);
  if (!err.empty()) {
    // e.g. out of memory or a dropped connection: free MuPDF's caches, try once more
    fz_empty_store(st_->ctx);
    out->clear();
    err = Render(n, width, out);
  }
  if (err.empty()) {
    if (st_->jpegs.size() >= 8) {
      st_->jpegs.erase(st_->jpeg_lru.back());
      st_->jpeg_lru.pop_back();
    }
    st_->jpegs[key] = *out;
    st_->jpeg_lru.push_front(key);
  }
  return err;
}

std::string PdfDoc::Render(int n, int width, std::string* out) {
  fz_context* ctx = st_->ctx;
  fz_page* volatile page = NULL;
  fz_pixmap* volatile pix = NULL;
  fz_buffer* volatile buf = NULL;
  fz_output* volatile o = NULL;
  std::string err;
  st_->error.clear();
  fz_try(ctx) {
    page = fz_load_page(ctx, st_->doc, n);
    fz_rect r = fz_bound_page(ctx, page);
    float w = r.x1 - r.x0, h = r.y1 - r.y0;
    float scale = w > 0 ? static_cast<float>(width) / w : 1.0f;
    if (h * scale > 3000) scale = 3000 / h;  // very tall pages: limit memory
    pix = fz_new_pixmap_from_page(ctx, page, fz_scale(scale, scale), fz_device_rgb(ctx), 0);
    buf = fz_new_buffer(ctx, 256 * 1024);
    o = fz_new_output_with_buffer(ctx, buf);
    fz_write_pixmap_as_jpeg(ctx, o, pix, 85);
    fz_close_output(ctx, o);
    unsigned char* data = NULL;
    size_t len = fz_buffer_storage(ctx, buf, &data);
    out->assign(reinterpret_cast<const char*>(data), len);
  }
  fz_always(ctx) {
    fz_drop_output(ctx, o);
    fz_drop_buffer(ctx, buf);
    fz_drop_pixmap(ctx, pix);
    fz_drop_page(ctx, page);
  }
  fz_catch(ctx) {
    err = std::string("pdf: ") + fz_caught_message(ctx);
    if (!st_->error.empty()) err += " (" + st_->error + ")";
  }
  return err;
}

}  // namespace book
