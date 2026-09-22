# Rebuilding the cursor assets

`resources/cursor-default.png` and `resources/cursor-clickable.png` (referenced
from the `--cursor-*` tokens in `frontend/ui/styles/zzz.css`) are derived from
`resources/c1.png` and `resources/c2.png`, not committed as-is: the source art
is black-on-transparent at a size much larger than a cursor needs, with a lot
of transparent padding around the glyph. If the source art changes, redo this
rather than hand-editing the derived PNGs.

```python
from PIL import Image

PAD = 4                          # transparent padding kept around the glyph
TARGET = {"c1": 26, "c2": 32}    # target *longer* side in px

for key, name in (("c1", "resources/c1.png"), ("c2", "resources/c2.png")):
    im = Image.open(name).convert("RGBA")

    # Trim to the glyph's own bounding box, plus a small margin.
    x0, y0, x1, y1 = im.getbbox()
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
    x1, y1 = min(im.width, x1 + PAD), min(im.height, y1 + PAD)
    cropped = im.crop((x0, y0, x1, y1))

    # Black glyph -> white. Alpha (and its antialiasing) carries over
    # untouched, only the RGB channels change.
    white = Image.new("RGBA", cropped.size, (255, 255, 255, 0))
    white.putalpha(cropped.split()[3])

    # Scale to cursor size.
    scale = TARGET[key] / max(white.size)
    resized = white.resize(
        (round(white.width * scale), round(white.height * scale)), Image.LANCZOS
    )
    resized.save(f"resources/cursor-{'default' if key == 'c1' else 'clickable'}.png")
```

**Hotspot.** The `cursor:` declaration's `x y` offset must point at the arrow's
visual tip, in the *resized* image's own pixel coordinates. Found as the first
opaque pixel scanning top-to-bottom then left-to-right — the topmost row that
has any non-transparent pixel, and the leftmost such pixel within that row —
computed on the cropped-but-not-yet-resized image and then scaled by the same
factor as the resize:

```python
def topmost_leftmost(im):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] > 128:
                return x, y

tip_x, tip_y = topmost_leftmost(white)  # before resizing
hotspot = (round(tip_x * scale), round(tip_y * scale))
```

For the current assets this gives `(6, 2)` for the default cursor and
`(10, 2)` for the clickable one — already baked into the CSS `cursor:` values,
so this only needs re-running if the source art is replaced.
