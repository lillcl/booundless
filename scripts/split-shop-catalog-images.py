#!/usr/bin/env python3
"""Split the ten transparent 3x3 catalogue sheets into product PNGs.

The generated objects sometimes cross an equal grid boundary. ImageMagick's
connected-component label map lets us assign complete objects to the nearest
cell while dropping the small text labels and neighbouring fragments.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CATALOG_SOURCE = ROOT / "db" / "shop-catalog.js"
SHEET_DIR = ROOT / "assets" / "shop-catalog"
OUTPUT_DIR = SHEET_DIR / "products"
CELL = 418
CANVAS = 418
MAX_CONTENT = 390
DERIVED_PRODUCTS = {
    "hybrid-coolant": ["engine-coolant", "ev-coolant"],
    "hybrid-zone-coolant": ["engine-coolant", "hybrid-battery-filter"],
    "motorcycle-brake-pad": ["front-brake-pads", "rear-brake-pads"],
    "motorcycle-tyre": ["passenger-tyre"],
    "basic-service-kit": ["full-synthetic-engine-oil", "oil-filter"],
    "minor-service-kit": ["full-synthetic-engine-oil", "oil-filter", "engine-air-filter"],
    "ac-service-kit": ["cabin-filter", "ac-deodorizer"],
    "brake-service-kit": ["front-brake-pads", "brake-fluid-dot4"],
    "used-car-baseline-kit": ["obd2-scanner", "tyre-pressure-gauge", "flashlight"],
    "road-trip-emergency-kit": ["first-aid-kit", "warning-triangle", "tyre-repair-kit"],
    "car-care-bundle": ["car-shampoo", "wash-mitt", "microfiber-cloth"],
}


def sheet_slugs() -> list[list[str]]:
    source = CATALOG_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"const PHOTO_SHEET_SLUGS = \[([\s\S]*?)\];", source)
    if not match:
        raise RuntimeError("PHOTO_SHEET_SLUGS not found")
    rows = re.findall(r"'([^']+)'", match.group(1))
    sheets = [row.split() for row in rows]
    if len(sheets) != 10 or any(len(sheet) != 9 for sheet in sheets):
        raise RuntimeError("Expected ten sheets containing nine slugs each")
    return sheets


def component_labels(sheet_path: Path) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".png") as handle:
        subprocess.run(
            [
                "magick",
                str(sheet_path),
                "-alpha",
                "extract",
                "-threshold",
                "1%",
                "-connected-components",
                "8",
                "-depth",
                "16",
                handle.name,
            ],
            check=True,
        )
        return np.asarray(Image.open(handle.name), dtype=np.uint16)


def component_groups(labels: np.ndarray) -> list[list[int]]:
    height, width = labels.shape
    flat = labels.ravel()
    areas = np.bincount(flat)
    yy, xx = np.indices((height, width))
    x_sum = np.bincount(flat, weights=xx.ravel())
    y_sum = np.bincount(flat, weights=yy.ravel())
    groups: list[list[int]] = [[] for _ in range(9)]

    for component_id in range(1, len(areas)):
        area = int(areas[component_id])
        if area < 100:
            continue
        ys, xs = np.where(labels == component_id)
        if not len(xs):
            continue
        component_height = int(ys.max() - ys.min() + 1)
        # Product objects are tall enough to distinguish them from the printed
        # caption lines while retaining detached caps, cables and accessories.
        if component_height < 55 or area < 100:
            continue
        center_x = x_sum[component_id] / area
        center_y = y_sum[component_id] / area
        column = min(2, max(0, round((center_x - CELL / 2) / CELL)))
        row = min(2, max(0, round((center_y - CELL / 2) / CELL)))
        groups[row * 3 + column].append(component_id)

    return groups


def export_cell(source: Image.Image, labels: np.ndarray, ids: list[int], output: Path) -> None:
    rgba = np.asarray(source).copy()
    mask = np.isin(labels, ids)
    rgba[..., 3] = np.where(mask, rgba[..., 3], 0)
    ys, xs = np.where(rgba[..., 3] > 0)
    if not len(xs):
        raise RuntimeError(f"No product object found for {output.name}")
    crop = Image.fromarray(rgba, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    scale = min(MAX_CONTENT / crop.width, MAX_CONTENT / crop.height, 1)
    if scale < 1:
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((CANVAS - crop.width) // 2, (CANVAS - crop.height) // 2))
    canvas.save(output, optimize=True)


def trimmed_product(slug: str) -> Image.Image:
    image = Image.open(OUTPUT_DIR / f"{slug}.png").convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError(f"Empty source image: {slug}")
    return image.crop(alpha_box)


def export_composite(slug: str, sources: list[str]) -> None:
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    if len(sources) == 1:
        item = trimmed_product(sources[0])
        item.thumbnail((340, 340), Image.Resampling.LANCZOS)
        item = item.rotate(-6, resample=Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(item, ((CANVAS - item.width) // 2, (CANVAS - item.height) // 2))
    else:
        size = 235 if len(sources) == 2 else 178
        positions = (
            [(4, 92), (179, 108)]
            if len(sources) == 2
            else [(2, 130), (120, 72), (238, 132)]
        )
        for index, (source_slug, position) in enumerate(zip(sources, positions, strict=True)):
            item = trimmed_product(source_slug)
            item.thumbnail((size, size), Image.Resampling.LANCZOS)
            if len(sources) == 2:
                item = item.rotate(-4 if index == 0 else 4, resample=Image.Resampling.BICUBIC, expand=True)
            x = position[0] + (size - item.width) // 2
            y = position[1] + (size - item.height) // 2
            canvas.alpha_composite(item, (x, y))
    canvas.save(OUTPUT_DIR / f"{slug}.png", optimize=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for sheet_index, slugs in enumerate(sheet_slugs(), start=1):
        sheet_path = SHEET_DIR / f"sheet-{sheet_index}.png"
        source = Image.open(sheet_path).convert("RGBA")
        labels = component_labels(sheet_path)
        groups = component_groups(labels)
        for slug, ids in zip(slugs, groups, strict=True):
            export_cell(source, labels, ids, OUTPUT_DIR / f"{slug}.png")
            count += 1
    for slug, sources in DERIVED_PRODUCTS.items():
        export_composite(slug, sources)
        count += 1
    print(f"created {count} transparent product images")


if __name__ == "__main__":
    main()
