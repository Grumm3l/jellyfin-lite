/* force-included when building MuPDF for NaCl: newlib's <sys/types.h> has a
   'quad_t' typedef, MuPDF's draw-path.c a function of that name. Read the
   system header first, then rename MuPDF's symbol. */
#ifndef JF_MUPDF_COMPAT_H
#define JF_MUPDF_COMPAT_H
#include <sys/types.h>
#define quad_t fz_draw_quad_t
#endif
