// PC test for native/src/book.cpp, rarmini.cpp and pdfdoc.cpp ("nix run .#test-books -- file.cbr").
// book_test <archive> [outdir]: prints the index and extracts the first,
// middle and last page (and every entry with --all) into outdir.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>

#include <sys/time.h>

#include "book.hpp"
#ifdef WITH_PDF
#include "pdfdoc.hpp"
#endif

static inline double Ms() {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0;
}

namespace book {
std::string RarExtract(const std::string& archive, std::string* out);
}

class FileSource : public book::RangeSource {
 public:
  explicit FileSource(const char* path) : f_(fopen(path, "rb")), bytes_(0) {
    if (f_) { fseek(f_, 0, SEEK_END); size_ = ftell(f_); }
  }
  ~FileSource() { if (f_) fclose(f_); }
  int64_t Size() { return size_; }
  std::string Read(int64_t off, int64_t len, std::string* out) {
    out->resize(static_cast<size_t>(len));
    fseek(f_, off, SEEK_SET);
    size_t n = fread(&(*out)[0], 1, static_cast<size_t>(len), f_);
    out->resize(n);
    bytes_ += n;
    return n == static_cast<size_t>(len) ? "" : "short read";
  }
  bool ok() const { return f_ != NULL; }
  int64_t bytes() const { return bytes_; }

 private:
  FILE* f_;
  int64_t size_;
  int64_t bytes_;
};

int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: book_test archive [outdir] [--all]\n"); return 2; }
  FileSource src(argv[1]);
  if (!src.ok()) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
  const char* outdir = argc > 2 ? argv[2] : NULL;
  bool all = argc > 3 && strcmp(argv[3], "--all") == 0;
#ifdef WITH_PDF
  std::string head;
  src.Read(0, 8, &head);
  if (book::PdfDoc::IsPdf(head)) {
    book::PdfDoc pdf;
    double t0 = Ms();
    std::string perr = pdf.Open(&src);
    if (!perr.empty()) { printf("PDF OPEN ERROR: %s\n", perr.c_str()); return 1; }
    printf("format=pdf pages=%d open_requests=%d open_ms=%.0f\n", pdf.pages(), pdf.requests(), Ms() - t0);
    int n = pdf.pages(), fails = 0;
    int pick[3] = { 0, n / 2, n - 1 };
    for (int k = 0; k < 3; k++) {
      std::string jpg;
      int before = pdf.requests();
      double t1 = Ms();
      perr = pdf.RenderJpeg(pick[k], 1280, &jpg);
      printf("  page %d: %zu bytes jpeg, requests=%d, %.0f ms %s\n", pick[k], jpg.size(), pdf.requests() - before,
             Ms() - t1, perr.empty() ? "ok" : perr.c_str());
      if (!perr.empty() || jpg.size() < 4 || (unsigned char)jpg[0] != 0xff || (unsigned char)jpg[1] != 0xd8) fails++;
      if (outdir && perr.empty()) {
        std::string path = std::string(outdir) + "/pdf" + std::to_string(pick[k]) + ".jpg";
        FILE* f = fopen(path.c_str(), "wb");
        if (f) { fwrite(jpg.data(), 1, jpg.size(), f); fclose(f); }
      }
    }
    return fails ? 1 : 0;
  }
#endif
  book::Archive a;
  a.set_rar_extractor(book::RarExtract);
  std::string err = a.Open(&src);
  if (!err.empty()) { printf("OPEN ERROR: %s\n", err.c_str()); return 1; }
  printf("format=%s entries=%zu pages=%zu index_requests=%d index_bytes=%lld\n", a.format().c_str(),
         a.entries().size(), a.pages().size(), a.requests(), static_cast<long long>(src.bytes()));
  if (!a.pages().empty()) {
    printf("first=%s last=%s\n", a.entries()[a.pages().front()].name.c_str(),
           a.entries()[a.pages().back()].name.c_str());
  }
  int fails = 0;
  size_t n = a.pages().size();
  for (size_t k = 0; k < (all ? a.entries().size() : 3); k++) {
    int idx;
    if (all) idx = static_cast<int>(k);
    else if (!n) break;
    else idx = a.pages()[k == 0 ? 0 : k == 1 ? n / 2 : n - 1];
    const book::Entry& e = a.entries()[idx];
    std::string data;
    int before = a.requests();
    err = a.ReadEntry(&src, idx, &data);
    printf("  [%d] %-50s method=%d %lld bytes requests=%d %s\n", idx, e.name.c_str(), e.method,
           static_cast<long long>(data.size()), a.requests() - before, err.empty() ? "ok" : err.c_str());
    if (!err.empty() || static_cast<int64_t>(data.size()) != e.unp_size) fails++;
    if (outdir && err.empty()) {
      std::string path = std::string(outdir) + "/" + std::to_string(idx) + ".bin";
      FILE* f = fopen(path.c_str(), "wb");
      if (f) { fwrite(data.data(), 1, data.size(), f); fclose(f); }
      printf("      -> %s\n", path.c_str());
    }
  }
  return fails ? 1 : 0;
}
