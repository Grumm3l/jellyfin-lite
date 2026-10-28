// PDF pages rendered with MuPDF, read over byte ranges (see book.hpp).
#ifndef JF_PDFDOC_HPP
#define JF_PDFDOC_HPP

#include <string>

#include "book.hpp"

namespace book {

struct PdfState;

class PdfDoc {
 public:
  PdfDoc();
  ~PdfDoc();
  static bool IsPdf(const std::string& head) { return head.compare(0, 5, "%PDF-") == 0; }
  // Opens the document; returns "" or an error text.
  std::string Open(RangeSource* src);
  int pages() const { return pages_; }
  // Renders page n (0-based) as JPEG, scaled to the given width in pixels;
  // the last 8 rendered pages are kept, a failed render is retried once.
  std::string RenderJpeg(int n, int width, std::string* out);
  int requests() const;

 private:
  std::string Render(int n, int width, std::string* out);
  PdfState* st_;
  int pages_;
};

}  // namespace book

#endif
