"""Wave 1: bundled TTF fonts for RU/KK Cyrillic in ReportLab PDFs.

Problem: ReportLab's built-in Helvetica is WinAnsi (latin-only), so names
like `Аян` or `әіңғүұқөһ` render as tofu. The Docker image (python:slim)
ships no system fonts at all, so we bundle DejaVu Sans (OFL, see
assets/fonts/LICENSE-DejaVu) which covers Cyrillic incl. Kazakh glyphs.

Usage: `from app.services.pdf_fonts import ensure_fonts` once, then
`setFont("KWF", ...)` / `setFont("KWF-Bold", ...)`. Falls back to
Helvetica if the files are missing (latin-only, never crashes).
"""
from __future__ import annotations
from pathlib import Path

FONT = "KWF"
FONT_BOLD = "KWF-Bold"

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_registered = False


def ensure_fonts() -> tuple[str, str]:
    """Register bundled TTFs with ReportLab. Returns (regular, bold) names."""
    global _registered
    if _registered:
        return FONT, FONT_BOLD
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        regular = _FONTS_DIR / "DejaVuSans.ttf"
        bold = _FONTS_DIR / "DejaVuSans-Bold.ttf"
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont(FONT, str(regular)))
            pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold)))
            _registered = True
            return FONT, FONT_BOLD
    except Exception:
        pass
    # Fallback: stock latin-only fonts (dev without bundled files).
    return "Helvetica", "Helvetica-Bold"
