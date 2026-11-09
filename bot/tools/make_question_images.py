"""Одноразовый генератор картинок к вопросам чек-ина.

Рисует простые фигуры без текста, чтобы картинки не зависели от языка.
Запуск из корня репозитория: ``python -m bot.tools.make_question_images``.
"""
from pathlib import Path

from PIL import Image, ImageDraw

WIDTH = 640
HEIGHT = 360
SCALE = 2

INK = (28, 27, 34, 255)
YELLOW = (255, 214, 56, 255)
DEEP_YELLOW = (240, 178, 0, 255)
WHITE = (255, 255, 255, 255)
PALE = (232, 226, 213, 255)
SKY_TOP = (255, 249, 226)
SKY_BOTTOM = (255, 222, 128)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "questions"


def _box(*coords: float) -> list[int]:
    return [round(value * SCALE) for value in coords]


def _width(value: float) -> int:
    return max(1, round(value * SCALE))


def _background() -> Image.Image:
    size = (WIDTH * SCALE, HEIGHT * SCALE)
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        share = y / (size[1] - 1)
        color = tuple(round(top + (bottom - top) * share) for top, bottom in zip(SKY_TOP, SKY_BOTTOM))
        draw.line([(0, y), (size[0], y)], fill=color)

    halo = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse(_box(160, 20, 480, 340), fill=(255, 255, 255, 120))
    return Image.alpha_composite(image.convert("RGBA"), halo)


def _draw_energy(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(_box(182, 118, 408, 242), radius=_width(20), outline=INK, width=_width(10))
    draw.rounded_rectangle(_box(408, 156, 436, 204), radius=_width(8), fill=INK)
    for index in range(4):
        left = 210 + index * 48
        fill = YELLOW if index < 3 else PALE
        draw.rounded_rectangle(_box(left, 146, left + 36, 214), radius=_width(7), fill=fill)
    draw.polygon(
        _box(268, 62, 218, 148, 264, 148, 236, 208, 306, 120, 258, 120, 296, 62),
        fill=INK,
    )


def _draw_clarity(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image)
    for radius, width in ((106, 10), (66, 8)):
        draw.ellipse(
            _box(320 - radius, 180 - radius, 320 + radius, 180 + radius),
            outline=INK,
            width=_width(width),
        )
    draw.ellipse(_box(294, 154, 346, 206), fill=YELLOW, outline=INK, width=_width(8))
    draw.line(_box(320, 180, 402, 98), fill=INK, width=_width(10))
    draw.polygon(_box(402, 98, 372, 108, 392, 128), fill=INK)


def _draw_support(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image)
    draw.polygon(_box(196, 214, 196, 268, 246, 214), fill=WHITE, outline=INK, width=_width(7))
    draw.rounded_rectangle(_box(146, 100, 330, 234), radius=_width(30), fill=WHITE, outline=INK, width=_width(10))
    for center in (196, 238, 280):
        draw.ellipse(_box(center - 9, 158, center + 9, 176), fill=INK)

    draw.polygon(_box(388, 196, 388, 252, 438, 196), fill=YELLOW, outline=INK, width=_width(7))
    draw.rounded_rectangle(_box(330, 140, 496, 262), radius=_width(30), fill=YELLOW, outline=INK, width=_width(10))
    draw.rounded_rectangle(_box(396, 176, 430, 226), radius=_width(8), fill=WHITE)
    draw.rounded_rectangle(_box(378, 194, 448, 208), radius=_width(7), fill=WHITE)


DRAWERS = {
    "energy": _draw_energy,
    "clarity": _draw_clarity,
    "support": _draw_support,
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for key, painter in DRAWERS.items():
        image = _background()
        painter(image)
        image = image.convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
        path = OUTPUT_DIR / f"{key}.png"
        image.save(path, optimize=True)
        print(f"{path.relative_to(OUTPUT_DIR.parent.parent.parent)}: {WIDTH}x{HEIGHT}")


if __name__ == "__main__":
    main()
