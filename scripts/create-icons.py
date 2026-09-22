"""Regenerate committed PWA PNG icons (development only; requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'icons'
root.mkdir(exist_ok=True)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('icon-maskable.png', 512)]:
    image = Image.new('RGB', (512, 512), '#173e35')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((145, 112, 365, 400), radius=10, fill='#f5f3ec')
    draw.rectangle((145, 112, 174, 400), fill='#d3ee6e')
    draw.polygon([(195, 288), (239, 218), (266, 257), (290, 228), (334, 288)], fill='#173e35')
    draw.line((201, 326, 326, 326), fill='#173e35', width=12)
    draw.line((201, 350, 293, 350), fill='#173e35', width=12)
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / name)
