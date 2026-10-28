// Random access to comic/e-book archives (ZIP, RAR4, RAR5) over byte ranges.
// Portable C++ (no Pepper): used by the NaCl module and by the host tests.
#ifndef JF_BOOK_HPP
#define JF_BOOK_HPP

#include <stdint.h>
#include <string>
#include <vector>

namespace book {

// Byte-range access to one archive (HTTP range requests on the TV).
class RangeSource {
 public:
  virtual ~RangeSource() {}
  virtual int64_t Size() = 0;
  // Reads [off, off+len) into *out; returns "" or an error text.
  virtual std::string Read(int64_t off, int64_t len, std::string* out) = 0;
};

struct Entry {
  std::string name;
  int method;          // ZIP: 0 store, 8 deflate. RAR: 0 store, >0 compressed
  int64_t hdr_off;     // ZIP: local header, RAR: file header
  int64_t hdr_size;    // RAR: size of the file header block
  int64_t data_off;    // RAR: packed data (ZIP: computed from the local header)
  int64_t pack_size;
  int64_t unp_size;
  bool unsupported;    // encrypted, split or solid
};

// Extracts one compressed RAR file from a mini archive held in memory
// (implemented with libarchive; see rarmini.cpp).
typedef std::string (*RarExtractFn)(const std::string& archive, std::string* out);

class Archive {
 public:
  Archive() : requests_(0), rar_extract_(0) {}
  void set_rar_extractor(RarExtractFn fn) { rar_extract_ = fn; }

  // Reads the index; returns "" or an error text.
  std::string Open(RangeSource* src);

  const std::string& format() const { return format_; }
  const std::vector<Entry>& entries() const { return entries_; }
  // Image entries in natural reading order (indices into entries()).
  const std::vector<int>& pages() const { return pages_; }
  // Entry by path (EPUB), -1 if missing.
  int Find(const std::string& path) const;
  // Reads and unpacks one entry.
  std::string ReadEntry(RangeSource* src, int index, std::string* out);
  int requests() const { return requests_; }

 private:
  std::string OpenZip(RangeSource* src);
  std::string OpenRar4(RangeSource* src);
  std::string OpenRar5(RangeSource* src);
  std::string Rar5QuickOpen(RangeSource* src, int64_t qo_pos);
  std::string Rar5ParseFileHeader(const std::string& h, int64_t pos, Entry* e);
  std::string ReadRange(RangeSource* src, int64_t off, int64_t len, std::string* out);
  void SortPages();

  std::string format_;
  std::string rar_prefix_;  // signature + main header (rebuilt for RAR5)
  std::vector<Entry> entries_;
  std::vector<int> pages_;
  int requests_;
  RarExtractFn rar_extract_;
};

// Natural "a2" < "a10" ordering, case-insensitive.
bool NaturalLess(const std::string& a, const std::string& b);

}  // namespace book

#endif
