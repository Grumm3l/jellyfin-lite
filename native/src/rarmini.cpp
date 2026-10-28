// Unpacks the single file of a RAR "mini archive" (see book.cpp) with
// libarchive (BSD license), straight from memory: RAR4 and RAR5, stored or
// compressed. libarchive's RAR readers are a free reimplementation, so no
// unrar code is involved.
#include <stdio.h>

#include <string>

#include "archive.h"
#include "archive_entry.h"

namespace book {

std::string RarExtract(const std::string& mini, std::string* out) {
  struct archive* a = archive_read_new();
  if (!a) return "rar: no memory";
  archive_read_support_format_rar(a);
  archive_read_support_format_rar5(a);
  std::string err;
  struct archive_entry* entry = NULL;
  if (archive_read_open_memory(a, mini.data(), mini.size()) != ARCHIVE_OK) {
    err = std::string("rar: open failed (") + archive_error_string(a) + ")";
  } else if (archive_read_next_header(a, &entry) != ARCHIVE_OK) {
    err = std::string("rar: bad header (") + (archive_error_string(a) ? archive_error_string(a) : "?") + ")";
  } else {
    out->clear();
    if (archive_entry_size_is_set(entry)) out->reserve(static_cast<size_t>(archive_entry_size(entry)));
    char buf[65536];
    for (;;) {
      la_ssize_t n = archive_read_data(a, buf, sizeof(buf));
      if (n == 0) break;
      if (n < 0) {
        const char* msg = archive_error_string(a);
        err = std::string("rar: extract failed (") + (msg ? msg : "?") + ")";
        break;
      }
      out->append(buf, static_cast<size_t>(n));
    }
  }
  archive_read_free(a);
  return err;
}

}  // namespace book
