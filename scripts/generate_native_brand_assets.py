from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "leagues"
OUT = ROOT / "native-brands" / "shinobistrikerleague"
BLACK = (0, 0, 0, 255)


def rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, BLACK)
    fitted = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return canvas


def icon_assets(logo: Image.Image) -> None:
    icon_1024 = logo.resize((1024, 1024), Image.Resampling.LANCZOS)
    save_png(icon_1024, OUT / "store" / "app-icon-1024.png")
    save_png(icon_1024.resize((512, 512), Image.Resampling.LANCZOS), OUT / "store" / "play-icon-512.png")

    feature = Image.new("RGBA", (1024, 500), BLACK)
    mark = ImageOps.contain(logo, (480, 480), Image.Resampling.LANCZOS)
    feature.alpha_composite(mark, ((1024 - mark.width) // 2, (500 - mark.height) // 2))
    save_png(feature, OUT / "store" / "play-feature-1024x500.png")

    density = {
        "ldpi": (36, 81),
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for name, (legacy_size, adaptive_size) in density.items():
        target = OUT / "android" / "res" / f"mipmap-{name}"
        legacy = logo.resize((legacy_size, legacy_size), Image.Resampling.LANCZOS)
        adaptive = logo.resize((adaptive_size, adaptive_size), Image.Resampling.LANCZOS)
        background = Image.new("RGBA", (adaptive_size, adaptive_size), BLACK)
        save_png(legacy, target / "ic_launcher.png")
        save_png(legacy, target / "ic_launcher_round.png")
        save_png(adaptive, target / "ic_launcher_foreground.png")
        save_png(background, target / "ic_launcher_background.png")


def splash_assets(logo: Image.Image, portrait: Image.Image) -> None:
    square = contain(portrait, (2732, 2732))
    save_png(square, OUT / "ios" / "splash-2732.png")

    sizes = {
        "drawable": (320, 480),
        "drawable-night": (320, 240),
        "drawable-port-ldpi": (240, 320),
        "drawable-port-mdpi": (320, 480),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-land-ldpi": (320, 240),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
    }
    for name, size in sizes.items():
        source = portrait if "port" in name or name == "drawable" else logo
        rendered = contain(source, size)
        save_png(rendered, OUT / "android" / "res" / name / "splash.png")
        if name.startswith("drawable-port-"):
            night_name = name.replace("drawable-port-", "drawable-port-night-", 1)
            save_png(rendered, OUT / "android" / "res" / night_name / "splash.png")
        elif name.startswith("drawable-land-"):
            night_name = name.replace("drawable-land-", "drawable-land-night-", 1)
            save_png(rendered, OUT / "android" / "res" / night_name / "splash.png")


def main() -> None:
    logo = rgba(SOURCE_DIR / "shinobistrikerleague-enterprise.png")
    portrait = rgba(SOURCE_DIR / "shinobistrikerleague-source.jpg")
    icon_assets(logo)
    splash_assets(logo, portrait)
    save_png(logo.resize((1024, 1024), Image.Resampling.LANCZOS), OUT / "ios" / "app-icon-1024.png")
    print(f"Generated native brand assets in {OUT}")


if __name__ == "__main__":
    main()
