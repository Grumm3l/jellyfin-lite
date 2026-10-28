// Random access to ZIP / RAR4 / RAR5 archives over byte ranges (see book.hpp).
#include "book.hpp"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include <algorithm>

#include <zlib.h>

namespace book {

namespace {

const int64_t kChunk = 16384;  // one request reads a whole header

uint32_t Le16(const std::string& b, size_t p) {
  return static_cast<uint8_t>(b[p]) | (static_cast<uint8_t>(b[p + 1]) << 8);
}
uint32_t Le32(const std::string& b, size_t p) {
  return Le16(b, p) | (Le16(b, p + 2) << 16);
}
uint64_t Le64(const std::string& b, size_t p) {
  return Le32(b, p) | (static_cast<uint64_t>(Le32(b, p + 4)) << 32);
}

// RAR5 variable-length integer; returns false when out of data
bool VInt(const std::string& b, size_t* p, uint64_t* v) {
  *v = 0;
  for (int shift = 0; *p < b.size() && shift < 64; shift += 7) {
    uint8_t c = static_cast<uint8_t>(b[(*p)++]);
    *v |= static_cast<uint64_t>(c & 0x7f) << shift;
    if (!(c & 0x80)) return true;
  }
  return false;
}

void PutVInt(std::string* out, uint64_t v) {
  do {
    uint8_t c = v & 0x7f;
    v >>= 7;
    if (v) c |= 0x80;
    out->push_back(static_cast<char>(c));
  } while (v);
}

// RAR5 header with CRC32 over size field + body
std::string Rar5Header(const std::string& body) {
  std::string sized;
  PutVInt(&sized, body.size());
  sized += body;
  uint32_t crc = crc32(0, reinterpret_cast<const Bytef*>(sized.data()), sized.size());
  std::string out;
  for (int i = 0; i < 4; i++) out.push_back(static_cast<char>((crc >> (8 * i)) & 0xff));
  return out + sized;
}

std::string Lower(std::string s) {
  for (size_t i = 0; i < s.size(); i++) s[i] = static_cast<char>(tolower(static_cast<unsigned char>(s[i])));
  return s;
}

bool IsImage(const std::string& name) {
  std::string n = Lower(name);
  size_t slash = n.find_last_of("/\\");
  std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
  if (base.empty() || base[0] == '.' || n.find("__macosx") != std::string::npos) return false;
  static const char* kExt[] = { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp" };
  for (size_t i = 0; i < sizeof(kExt) / sizeof(kExt[0]); i++) {
    size_t l = strlen(kExt[i]);
    if (n.size() > l && n.compare(n.size() - l, l, kExt[i]) == 0) return true;
  }
  return false;
}

std::string Inflate(const std::string& in, int64_t unp_size, std::string* out) {
  z_stream z;
  memset(&z, 0, sizeof(z));
  if (inflateInit2(&z, -MAX_WBITS) != Z_OK) return "inflateInit failed";
  out->resize(static_cast<size_t>(unp_size));
  z.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(in.data()));
  z.avail_in = static_cast<uInt>(in.size());
  z.next_out = reinterpret_cast<Bytef*>(out->empty() ? 0 : &(*out)[0]);
  z.avail_out = static_cast<uInt>(out->size());
  int r = inflate(&z, Z_FINISH);
  inflateEnd(&z);
  if (r != Z_STREAM_END) return "inflate failed";
  out->resize(z.total_out);
  return "";
}

}  // namespace

bool NaturalLess(const std::string& a, const std::string& b) {
  size_t i = 0, j = 0;
  while (i < a.size() && j < b.size()) {
    unsigned char ca = static_cast<unsigned char>(a[i]), cb = static_cast<unsigned char>(b[j]);
    if (isdigit(ca) && isdigit(cb)) {
      size_t i2 = i, j2 = j;
      while (i2 < a.size() && a[i2] == '0') i2++;
      while (j2 < b.size() && b[j2] == '0') j2++;
      size_t ie = i2, je = j2;
      while (ie < a.size() && isdigit(static_cast<unsigned char>(a[ie]))) ie++;
      while (je < b.size() && isdigit(static_cast<unsigned char>(b[je]))) je++;
      if (ie - i2 != je - j2) return ie - i2 < je - j2;
      int c = a.compare(i2, ie - i2, b, j2, je - j2);
      if (c) return c < 0;
      i = ie;
      j = je;
      continue;
    }
    ca = static_cast<unsigned char>(tolower(ca));
    cb = static_cast<unsigned char>(tolower(cb));
    if (ca != cb) return ca < cb;
    i++;
    j++;
  }
  return a.size() - i < b.size() - j;
}

std::string Archive::ReadRange(RangeSource* src, int64_t off, int64_t len, std::string* out) {
  int64_t size = src->Size();
  if (off >= size) return "read past end";
  if (off + len > size) len = size - off;
  requests_++;
  return src->Read(off, len, out);
}

std::string Archive::Open(RangeSource* src) {
  std::string head;
  std::string err = ReadRange(src, 0, 8, &head);
  if (!err.empty()) return err;
  if (head.size() >= 4 && head.compare(0, 4, "PK\x03\x04", 4) == 0) err = OpenZip(src);
  else if (head.size() >= 8 && head.compare(0, 8, "Rar!\x1a\x07\x01\x00", 8) == 0) err = OpenRar5(src);
  else if (head.size() >= 7 && head.compare(0, 7, "Rar!\x1a\x07\x00", 7) == 0) err = OpenRar4(src);
  else return "unknown archive format";
  if (!err.empty()) return err;
  SortPages();
  return "";
}

void Archive::SortPages() {
  pages_.clear();
  for (size_t i = 0; i < entries_.size(); i++) {
    if (!entries_[i].unsupported && IsImage(entries_[i].name)) pages_.push_back(static_cast<int>(i));
  }
  struct ByName {
    const std::vector<Entry>* e;
    bool operator()(int a, int b) const { return NaturalLess((*e)[a].name, (*e)[b].name); }
  } cmp = { &entries_ };
  std::sort(pages_.begin(), pages_.end(), cmp);
}

int Archive::Find(const std::string& path) const {
  for (size_t i = 0; i < entries_.size(); i++) {
    if (entries_[i].name == path) return static_cast<int>(i);
  }
  std::string lp = Lower(path);
  for (size_t i = 0; i < entries_.size(); i++) {
    if (Lower(entries_[i].name) == lp) return static_cast<int>(i);
  }
  return -1;
}

// ---------- ZIP ----------

std::string Archive::OpenZip(RangeSource* src) {
  format_ = "zip";
  int64_t size = src->Size();
  int64_t tail_off = size > 65558 ? size - 65558 : 0;
  std::string tail;
  std::string err = ReadRange(src, tail_off, size - tail_off, &tail);
  if (!err.empty()) return err;
  size_t e = tail.rfind(std::string("PK\x05\x06", 4));
  if (e == std::string::npos || e + 22 > tail.size()) return "zip: no end of central directory";
  uint64_t cd_size = Le32(tail, e + 12);
  uint64_t cd_off = Le32(tail, e + 16);
  if (cd_off == 0xffffffffu || cd_size == 0xffffffffu) {
    size_t l = tail.rfind(std::string("PK\x06\x07", 4), e);
    if (l == std::string::npos) return "zip64: no locator";
    uint64_t z64 = Le64(tail, l + 8);
    std::string rec;
    err = ReadRange(src, static_cast<int64_t>(z64), 56, &rec);
    if (!err.empty()) return err;
    if (rec.size() < 56 || rec.compare(0, 4, "PK\x06\x06", 4) != 0) return "zip64: bad record";
    cd_size = Le64(rec, 40);
    cd_off = Le64(rec, 48);
  }
  std::string cd;
  if (static_cast<int64_t>(cd_off) >= tail_off) {
    cd = tail.substr(static_cast<size_t>(cd_off - tail_off), static_cast<size_t>(cd_size));
  } else {
    err = ReadRange(src, static_cast<int64_t>(cd_off), static_cast<int64_t>(cd_size), &cd);
    if (!err.empty()) return err;
  }
  size_t p = 0;
  while (p + 46 <= cd.size() && cd.compare(p, 4, "PK\x01\x02", 4) == 0) {
    Entry en;
    uint32_t flags = Le16(cd, p + 8);
    en.method = static_cast<int>(Le16(cd, p + 10));
    en.pack_size = Le32(cd, p + 20);
    en.unp_size = Le32(cd, p + 24);
    size_t nl = Le16(cd, p + 28), el = Le16(cd, p + 30), cl = Le16(cd, p + 32);
    en.hdr_off = Le32(cd, p + 42);
    en.name = cd.substr(p + 46, nl);
    // ZIP64 extra field: 64-bit values for the fields set to 0xffffffff
    size_t x = p + 46 + nl, xe = x + el;
    while (x + 4 <= xe && xe <= cd.size()) {
      uint32_t id = Le16(cd, x), len = Le16(cd, x + 2);
      if (id == 1) {
        size_t q = x + 4;
        if (en.unp_size == 0xffffffffLL && q + 8 <= x + 4 + len) { en.unp_size = static_cast<int64_t>(Le64(cd, q)); q += 8; }
        if (en.pack_size == 0xffffffffLL && q + 8 <= x + 4 + len) { en.pack_size = static_cast<int64_t>(Le64(cd, q)); q += 8; }
        if (en.hdr_off == 0xffffffffLL && q + 8 <= x + 4 + len) { en.hdr_off = static_cast<int64_t>(Le64(cd, q)); }
      }
      x += 4 + len;
    }
    en.hdr_size = 0;
    en.data_off = -1;
    en.unsupported = (flags & 1) != 0 || (en.method != 0 && en.method != 8);
    if (!en.name.empty() && en.name[en.name.size() - 1] != '/') entries_.push_back(en);
    p += 46 + nl + el + cl;
  }
  return entries_.empty() ? "zip: no entries" : "";
}

// ---------- RAR4 ----------

std::string Archive::OpenRar4(RangeSource* src) {
  format_ = "rar4";
  int64_t size = src->Size();
  int64_t pos = 7;  // after the marker block
  bool solid = false;
  while (pos + 7 <= size) {
    std::string h;
    std::string err = ReadRange(src, pos, kChunk, &h);
    if (!err.empty()) return err;
    if (h.size() < 7) break;
    uint8_t type = static_cast<uint8_t>(h[2]);
    uint32_t flags = Le16(h, 3);
    uint32_t hsize = Le16(h, 5);
    if (hsize < 7) return "rar4: bad header";
    if (hsize > h.size()) {
      err = ReadRange(src, pos, hsize, &h);
      if (!err.empty()) return err;
    }
    int64_t add = 0;
    if (type == 0x73) {  // main header
      solid = (flags & 0x0008) != 0;
      rar_prefix_.clear();
      std::string all;
      err = ReadRange(src, 0, pos + hsize, &all);
      if (!err.empty()) return err;
      rar_prefix_ = all;
    } else if (type == 0x74 && hsize >= 32) {  // file header
      Entry en;
      int64_t pack = Le32(h, 7), unp = Le32(h, 11);
      size_t name_off = 32;
      if (flags & 0x100) {
        pack |= static_cast<int64_t>(Le32(h, 32)) << 32;
        unp |= static_cast<int64_t>(Le32(h, 36)) << 32;
        name_off = 40;
      }
      size_t nl = Le16(h, 26);
      std::string name = h.substr(name_off, nl);
      if (flags & 0x200) name = name.substr(0, name.find('\0'));  // ASCII part of a Unicode name
      en.name = name;
      for (size_t i = 0; i < en.name.size(); i++) if (en.name[i] == '\\') en.name[i] = '/';
      uint8_t method = static_cast<uint8_t>(h[25]);
      en.method = method == 0x30 ? 0 : method;
      en.hdr_off = pos;
      en.hdr_size = hsize;
      en.data_off = pos + hsize;
      en.pack_size = pack;
      en.unp_size = unp;
      en.unsupported = (flags & 0x07) != 0 || (flags & 0x10) != 0 || solid;  // split / encrypted / solid
      bool dir = (flags & 0xe0) == 0xe0;
      if (!dir) entries_.push_back(en);
      add = pack;
    } else if (type == 0x7b) {
      break;
    } else if (flags & 0x8000) {
      add = Le32(h, 7);
    }
    pos += hsize + add;
  }
  if (rar_prefix_.empty()) return "rar4: no main header";
  return entries_.empty() ? "rar4: no entries" : "";
}

// ---------- RAR5 ----------

// Parses a raw RAR5 file header (starting with CRC32) located at pos.
std::string Archive::Rar5ParseFileHeader(const std::string& h, int64_t pos, Entry* e) {
  size_t p = 4;
  uint64_t size, type, hflags, extra = 0, data = 0;
  if (!VInt(h, &p, &size)) return "rar5: bad header";
  size_t body = p;
  if (!VInt(h, &p, &type) || !VInt(h, &p, &hflags)) return "rar5: bad header";
  if (hflags & 1) VInt(h, &p, &extra);
  if (hflags & 2) VInt(h, &p, &data);
  uint64_t fflags, unp, attr, comp, host, nl;
  VInt(h, &p, &fflags);
  VInt(h, &p, &unp);
  VInt(h, &p, &attr);
  if (fflags & 2) p += 4;
  if (fflags & 4) p += 4;
  VInt(h, &p, &comp);
  VInt(h, &p, &host);
  if (!VInt(h, &p, &nl) || p + nl > h.size()) return "rar5: bad name";
  e->name = h.substr(p, static_cast<size_t>(nl));
  // extra area records: type 1 = encryption
  bool encrypted = false;
  size_t x = body + static_cast<size_t>(size) - static_cast<size_t>(extra);
  while (extra && x < body + size) {
    uint64_t rsize, rtype;
    size_t r = x;
    if (!VInt(h, &r, &rsize) || rsize == 0) break;
    size_t rend = r + static_cast<size_t>(rsize);  // size counts from the type field
    if (!VInt(h, &r, &rtype)) break;
    if (rtype == 1) encrypted = true;
    x = rend;
  }
  e->hdr_off = pos;
  e->hdr_size = static_cast<int64_t>(body + size);
  e->data_off = pos + e->hdr_size;
  e->pack_size = static_cast<int64_t>(data);
  e->unp_size = static_cast<int64_t>(unp);
  e->method = static_cast<int>((comp >> 7) & 7);
  bool solid_file = (comp & 0x40) != 0;
  bool split = (hflags & 0x18) != 0;
  bool dir = (fflags & 1) != 0;
  e->unsupported = encrypted || solid_file || split || dir || type != 2;
  return "";
}

std::string Archive::OpenRar5(RangeSource* src) {
  format_ = "rar5";
  int64_t size = src->Size();
  int64_t pos = 8;
  bool solid = false;
  int64_t qo_pos = 0;
  while (pos + 7 <= size) {
    std::string h;
    std::string err = ReadRange(src, pos, kChunk, &h);
    if (!err.empty()) return err;
    size_t p = 4;
    uint64_t hsize, type, hflags, extra = 0, data = 0;
    if (!VInt(h, &p, &hsize)) return "rar5: bad header";
    size_t total = p + static_cast<size_t>(hsize);
    if (total > h.size()) {
      err = ReadRange(src, pos, total, &h);
      if (!err.empty()) return err;
    }
    size_t body = p;
    VInt(h, &p, &type);
    VInt(h, &p, &hflags);
    if (hflags & 1) VInt(h, &p, &extra);
    if (hflags & 2) VInt(h, &p, &data);
    if (type == 1) {  // main header: flags, then locator record in the extra area
      uint64_t aflags;
      VInt(h, &p, &aflags);
      solid = (aflags & 4) != 0;
      if (aflags & 1) return "rar5: multi-volume archives are not supported";
      size_t x = body + static_cast<size_t>(hsize) - static_cast<size_t>(extra);
      while (extra && x < total) {
        uint64_t rsize, rtype;
        size_t r = x;
        if (!VInt(h, &r, &rsize) || rsize == 0) break;
        size_t rend = r + static_cast<size_t>(rsize);
        if (!VInt(h, &r, &rtype)) break;
        if (rtype == 1) {  // locator: quick open offset relative to this header
          uint64_t lflags, qo = 0;
          VInt(h, &r, &lflags);
          if (lflags & 1) VInt(h, &r, &qo);
          if (qo) qo_pos = pos + static_cast<int64_t>(qo);
        }
        x = rend;
      }
      // rebuilt main header: no locator (the mini archive has no quick open data)
      std::string mh;
      mh.push_back(1);
      mh.push_back(0);
      PutVInt(&mh, solid ? 4 : 0);
      rar_prefix_ = std::string("Rar!\x1a\x07\x01\x00", 8) + Rar5Header(mh);
      if (qo_pos) {
        std::string qerr = Rar5QuickOpen(src, qo_pos);
        if (qerr.empty()) return "";
        entries_.clear();  // fall back to walking all headers
      }
    } else if (type == 2) {
      Entry en;
      err = Rar5ParseFileHeader(h.substr(0, total), pos, &en);
      if (!err.empty()) return err;
      if (solid) en.unsupported = true;
      entries_.push_back(en);
    } else if (type == 5) {
      break;
    }
    pos += static_cast<int64_t>(total) + static_cast<int64_t>(data);
  }
  return entries_.empty() ? "rar5: no entries" : "";
}

// Quick open: a service header "QO" whose data holds copies of all headers.
std::string Archive::Rar5QuickOpen(RangeSource* src, int64_t qo_pos) {
  std::string h;
  std::string err = ReadRange(src, qo_pos, kChunk, &h);
  if (!err.empty()) return err;
  size_t p = 4;
  uint64_t hsize, type, hflags, extra = 0, data = 0;
  if (!VInt(h, &p, &hsize)) return "qo: bad header";
  size_t total = p + static_cast<size_t>(hsize);
  VInt(h, &p, &type);
  VInt(h, &p, &hflags);
  if (hflags & 1) VInt(h, &p, &extra);
  if (hflags & 2) VInt(h, &p, &data);
  if (type != 3 || h.find("QO", p) == std::string::npos) return "qo: not a quick open header";
  std::string qd;
  err = ReadRange(src, qo_pos + static_cast<int64_t>(total), static_cast<int64_t>(data), &qd);
  if (!err.empty()) return err;
  size_t q = 0;
  while (q + 7 <= qd.size()) {
    size_t r = q + 4;
    uint64_t bsize, flags, offset, hlen;
    if (!VInt(qd, &r, &bsize)) break;
    size_t end = r + static_cast<size_t>(bsize);
    if (end > qd.size() || bsize == 0) break;
    VInt(qd, &r, &flags);
    VInt(qd, &r, &offset);
    VInt(qd, &r, &hlen);
    if (r + hlen > end) break;
    std::string hdr = qd.substr(r, static_cast<size_t>(hlen));
    int64_t hpos = qo_pos - static_cast<int64_t>(offset);
    size_t hp = 4;
    uint64_t s2, t2;
    if (VInt(hdr, &hp, &s2) && VInt(hdr, &hp, &t2) && t2 == 2) {
      Entry en;
      if (Rar5ParseFileHeader(hdr, hpos, &en).empty()) entries_.push_back(en);
    }
    q = end;
  }
  return entries_.empty() ? "qo: no entries" : "";
}

// ---------- reading entries ----------

std::string Archive::ReadEntry(RangeSource* src, int index, std::string* out) {
  if (index < 0 || index >= static_cast<int>(entries_.size())) return "no such entry";
  const Entry& e = entries_[index];
  if (e.unsupported) return "entry not supported (encrypted, split or solid)";
  std::string err;
  if (format_ == "zip") {
    // local header + name/extra + data in one request (extra rarely > 1 KB)
    std::string buf;
    err = ReadRange(src, e.hdr_off, 30 + 1024 + e.pack_size, &buf);
    if (!err.empty()) return err;
    if (buf.size() < 30 || buf.compare(0, 4, "PK\x03\x04", 4) != 0) return "zip: bad local header";
    int64_t start = 30 + Le16(buf, 26) + Le16(buf, 28);
    std::string data;
    if (start + e.pack_size <= static_cast<int64_t>(buf.size())) {
      data = buf.substr(static_cast<size_t>(start), static_cast<size_t>(e.pack_size));
    } else {
      err = ReadRange(src, e.hdr_off + start, e.pack_size, &data);
      if (!err.empty()) return err;
    }
    if (e.method == 0) { out->swap(data); return ""; }
    return Inflate(data, e.unp_size, out);
  }
  if (e.method == 0) return ReadRange(src, e.data_off, e.pack_size, out);
  // compressed RAR: header + packed data form a mini archive for libarchive
  if (!rar_extract_) return "rar: no decompressor";
  std::string block;
  err = ReadRange(src, e.hdr_off, e.hdr_size + e.pack_size, &block);
  if (!err.empty()) return err;
  std::string mini = rar_prefix_ + block;
  if (format_ == "rar4") {
    mini += std::string("\xc4\x3d\x7b\x00\x40\x07\x00", 7);  // end of archive
  } else {
    std::string end;
    end.push_back(5);
    end.push_back(0);
    end.push_back(0);
    mini += Rar5Header(end);
  }
  return rar_extract_(mini, out);
}

}  // namespace book
