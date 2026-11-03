"""
Generate official Concord branding assets and Tauri desktop icons from VersionFinal.png
"""
import os
import sys
from collections import deque
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
SOURCE_IMG_PATH = os.path.join(PROJECT_ROOT, "assets", "branding", "proposals", "VersionFinal.png")
OUTPUT_BRANDING_DIR = os.path.join(PROJECT_ROOT, "assets", "branding")
TAURI_ICONS_DIR = os.path.join(PROJECT_ROOT, "concord-client", "src-tauri", "icons")
CLIENT_PUBLIC_DIR = os.path.join(PROJECT_ROOT, "concord-client", "public")

os.makedirs(OUTPUT_BRANDING_DIR, exist_ok=True)
os.makedirs(TAURI_ICONS_DIR, exist_ok=True)
os.makedirs(CLIENT_PUBLIC_DIR, exist_ok=True)

def load_source():
    print(f"Loading source: {SOURCE_IMG_PATH}")
    im = Image.open(SOURCE_IMG_PATH).convert("RGBA")
    return im

def clean_squircle_corners(im):
    """Make the black corners outside the squircle transparent with anti-aliasing."""
    arr = np.array(im)
    h, w = arr.shape[:2]
    
    # Outer dark corners (R, G, B all < 35)
    visited = np.zeros((h, w), dtype=bool)
    q = deque([(0, 0), (0, w-1), (h-1, 0), (h-1, w-1)])
    for y, x in q:
        visited[y, x] = True
    
    while q:
        y, x = q.popleft()
        for dy, dx in [(-1,0), (1,0), (0,-1), (0,1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if arr[ny, nx, 0] < 35 and arr[ny, nx, 1] < 35 and arr[ny, nx, 2] < 35:
                    visited[ny, nx] = True
                    q.append((ny, nx))
                    
    arr_out = arr.copy()
    arr_out[visited, 3] = 0
    return Image.fromarray(arr_out)

def extract_mascot(im):
    """Extract mascot only (white body + inner green features) on transparent background."""
    arr = np.array(im)
    h, w = arr.shape[:2]
    is_white = (arr[:,:,0] > 180) & (arr[:,:,1] > 180) & (arr[:,:,2] > 180)
    
    visited = np.zeros((h, w), dtype=bool)
    q = deque([(0, 0), (0, w-1), (h-1, 0), (h-1, w-1), (10, 10), (100, 100), (w//2, 10)])
    for y, x in q:
        visited[y, x] = True
        
    while q:
        y, x = q.popleft()
        for dy, dx in [(-1,0), (1,0), (0,-1), (0,1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if not is_white[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))
                    
    arr_mascot = arr.copy()
    arr_mascot[visited, 3] = 0
    return Image.fromarray(arr_mascot)

def rdp(points, epsilon):
    if len(points) < 3:
        return points
    p1 = np.array(points[0])
    p2 = np.array(points[-1])
    line_vec = p2 - p1
    line_len = np.linalg.norm(line_vec)
    if line_len == 0:
        dists = np.linalg.norm(np.array(points) - p1, axis=1)
    else:
        line_unit = line_vec / line_len
        vecs = np.array(points) - p1
        proj = np.dot(vecs, line_unit)[:, None] * line_unit
        dists = np.linalg.norm(vecs - proj, axis=1)
    dmax_idx = np.argmax(dists)
    if dists[dmax_idx] > epsilon:
        rec1 = rdp(points[:dmax_idx+1], epsilon)
        rec2 = rdp(points[dmax_idx:], epsilon)
        return rec1[:-1] + rec2
    return [points[0], points[-1]]

def trace_contour(binary_mask):
    h, w = binary_mask.shape
    y_idxs, x_idxs = np.where(binary_mask)
    if len(y_idxs) == 0:
        return []
    start = (y_idxs[0], x_idxs[0])
    dirs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    contour = [start]
    current = start
    b_dir = 6
    for _ in range(50000):
        found = False
        start_dir = (b_dir + 1) % 8
        for i in range(8):
            d_idx = (start_dir + i) % 8
            dy, dx = dirs[d_idx]
            ny, nx = current[0] + dy, current[1] + dx
            if 0 <= ny < h and 0 <= nx < w and binary_mask[ny, nx]:
                current = (ny, nx)
                contour.append(current)
                b_dir = (d_idx + 4) % 8
                found = True
                break
        if not found or current == start:
            break
    return contour

def points_to_svg_path(points, scale=1.0, offset=(0, 0)):
    if not points:
        return ""
    d = []
    first = points[0]
    d.append(f"M {(first[1]*scale + offset[0]):.2f} {(first[0]*scale + offset[1]):.2f}")
    for p in points[1:]:
        d.append(f"L {(p[1]*scale + offset[0]):.2f} {(p[0]*scale + offset[1]):.2f}")
    d.append("Z")
    return " ".join(d)

def generate_svgs(mascot_cropped, full_size=(1024, 1024)):
    arr = np.array(mascot_cropped)
    h, w = arr.shape[:2]
    
    # Outer body mask
    body_mask = arr[:,:,3] > 128
    body_contour = trace_contour(body_mask)
    body_simplified = rdp(body_contour, 1.5)
    
    # Inner green features
    is_green = (arr[:,:,3] > 100) & (arr[:,:,1] > 140) & (arr[:,:,0] < 80) & (arr[:,:,2] < 150)
    visited = np.zeros((h, w), dtype=bool)
    components = []
    for y in range(h):
        for x in range(w):
            if is_green[y, x] and not visited[y, x]:
                comp = []
                q = deque([(y, x)])
                visited[y, x] = True
                while q:
                    cy, cx = q.popleft()
                    comp.append((cy, cx))
                    for dy, dx in [(-1,0), (1,0), (0,-1), (0,1)]:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and is_green[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            q.append((ny, nx))
                if len(comp) > 100:
                    components.append(comp)
                    
    # Sort features: left eye (min X), right eye (middle X), smirk (max Y/X)
    features = []
    for comp in components:
        mask = np.zeros((h, w), dtype=bool)
        for y, x in comp:
            mask[y, x] = True
        cont = trace_contour(mask)
        simp = rdp(cont, 1.2)
        cx = sum(p[1] for p in comp) / len(comp)
        cy = sum(p[0] for p in comp) / len(comp)
        features.append({"cx": cx, "cy": cy, "pts": simp})
        
    features.sort(key=lambda f: f["cx"])
    left_eye = features[0]["pts"]
    right_eye = features[1]["pts"]
    smirk = features[2]["pts"]
    
    # Scale to viewBox 0 0 1024 1024
    # Center mascot within 1024x1024
    target_mascot_w = 720.0
    scale = target_mascot_w / w
    target_mascot_h = h * scale
    offset_x = (1024 - target_mascot_w) / 2
    offset_y = (1024 - target_mascot_h) / 2
    
    d_body = points_to_svg_path(body_simplified, scale, (offset_x, offset_y))
    d_left_eye = points_to_svg_path(left_eye, scale, (offset_x, offset_y))
    d_right_eye = points_to_svg_path(right_eye, scale, (offset_x, offset_y))
    d_smirk = points_to_svg_path(smirk, scale, (offset_x, offset_y))
    
    # Full logo SVG (squircle + mascot)
    svg_logo = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
  <defs>
    <linearGradient id="concord-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#24D366" />
      <stop offset="100%" stop-color="#1DB954" />
    </linearGradient>
    <filter id="soft-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.18" />
    </filter>
  </defs>
  <!-- Squircle Background -->
  <rect class="concord-squircle" x="32" y="32" width="960" height="960" rx="220" fill="url(#concord-bg)" />
  <!-- Mascot Container -->
  <g id="concord-mascot" filter="url(#soft-shadow)">
    <!-- White Body Silhouette -->
    <path class="concord-body" d="{d_body}" fill="#FFFFFF" />
    <!-- Left Eye -->
    <path class="concord-eye-left" d="{d_left_eye}" fill="#1DB954" />
    <!-- Right Eye -->
    <path class="concord-eye-right" d="{d_right_eye}" fill="#1DB954" />
    <!-- Mischievous Smirk -->
    <path class="concord-smirk" d="{d_smirk}" fill="#1DB954" />
  </g>
</svg>'''

    # Mascot-only SVG (transparent background, standalone)
    # Scaled to fit its own bounding box nicely
    svg_mascot = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{offset_x:.1f} {offset_y:.1f} {target_mascot_w:.1f} {target_mascot_h:.1f}" width="100%" height="100%">
  <g id="concord-mascot-isolated">
    <path class="concord-body" d="{d_body}" fill="#FFFFFF" />
    <path class="concord-eye-left" d="{d_left_eye}" fill="#1DB954" />
    <path class="concord-eye-right" d="{d_right_eye}" fill="#1DB954" />
    <path class="concord-smirk" d="{d_smirk}" fill="#1DB954" />
  </g>
</svg>'''

    return svg_logo, svg_mascot

def main():
    source_img = load_source()
    
    # 1. Clean squircle icon with transparent corners
    squircle_icon = clean_squircle_corners(source_img)
    squircle_icon_1024 = squircle_icon.resize((1024, 1024), Image.Resampling.LANCZOS)
    squircle_icon_1024.save(os.path.join(OUTPUT_BRANDING_DIR, "concord_icon_1024.png"))
    
    # 2. Extract mascot
    mascot_img = extract_mascot(source_img)
    mascot_bbox = mascot_img.getbbox()
    mascot_cropped = mascot_img.crop(mascot_bbox)
    mascot_cropped.save(os.path.join(OUTPUT_BRANDING_DIR, "concord_mascot.png"))
    
    print("Generating vector SVGs...")
    svg_logo, svg_mascot = generate_svgs(mascot_cropped)
    
    # Save SVGs in branding
    with open(os.path.join(OUTPUT_BRANDING_DIR, "concord_logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg_logo)
    with open(os.path.join(OUTPUT_BRANDING_DIR, "concord_mascot.svg"), "w", encoding="utf-8") as f:
        f.write(svg_mascot)
        
    # Copy SVGs to client public
    with open(os.path.join(CLIENT_PUBLIC_DIR, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg_logo)
    with open(os.path.join(CLIENT_PUBLIC_DIR, "mascot.svg"), "w", encoding="utf-8") as f:
        f.write(svg_mascot)
        
    print("Generating multi-resolution desktop icons...")
    # Generate Tauri sizes
    tauri_sizes = [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]
    
    for filename, size in tauri_sizes:
        resized = squircle_icon_1024.resize((size, size), Image.Resampling.LANCZOS)
        out_path = os.path.join(TAURI_ICONS_DIR, filename)
        resized.save(out_path)
        print(f"Generated Tauri icon: {filename} ({size}x{size})")
        
    # Generate multi-res icon.ico for Windows
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_dest = os.path.join(TAURI_ICONS_DIR, "icon.ico")
    squircle_icon_1024.save(ico_dest, format="ICO", sizes=ico_sizes)
    print(f"Generated multi-res icon.ico: {ico_dest}")
    
    # Also copy icon.ico and PNG to client public
    squircle_icon_1024.save(os.path.join(CLIENT_PUBLIC_DIR, "favicon.ico"), format="ICO", sizes=ico_sizes)
    squircle_icon_1024.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(CLIENT_PUBLIC_DIR, "logo.png"))
    mascot_cropped.save(os.path.join(CLIENT_PUBLIC_DIR, "mascot.png"))
    
    print("All branding assets generated successfully!")

if __name__ == "__main__":
    main()
