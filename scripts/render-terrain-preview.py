"""Standalone inspection of real terrain data, not an in-game screenshot.
python3 scripts/render-terrain-preview.py .sites-runtime/terrain-preview.json docs/terrain-v3-preview.png
Requires numpy and matplotlib; neither is a game/runtime dependency.
"""
import json
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

data = json.load(open(sys.argv[1]))
p = np.array(data['positions']).reshape(-1, 3)
colors = np.array(data['colors']).reshape(-1, 3)
indices = np.array(data['indices']).reshape(-1, 3)
faces = p[indices]
normal = np.cross(faces[:, 1] - faces[:, 0], faces[:, 2] - faces[:, 0])
normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
light = np.array([.4, .8, .45]); light /= np.linalg.norm(light)
shade = .5 + .5 * np.maximum(0, normal @ light)
linear = np.clip(colors[indices].mean(axis=1) * shade[:, None], 0, 1)
rgb = np.where(linear <= .0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)
fig = plt.figure(figsize=(16, 8), dpi=120, facecolor='#111b20')
fig.text(.04, .94, 'NIGHTFALL / TERRAIN 03', color='#f1e5c9', fontsize=21, weight='bold')
fig.text(.04, .9, f"Seed: {data['seed']}    128 × 128 cells    Real heightmap and vertex colors", color='#aabbb5', fontsize=12)
ax = fig.add_axes([.0, .07, .7, .82], projection='3d', facecolor='#111b20')
axis_faces = faces[:, :, [0, 2, 1]]  # plotting axes: X, Z, elevation
water = faces[:, :, 1].mean(axis=1) < -1.2
axis_faces[:, :, 2] = np.maximum(-1.2, axis_faces[:, :, 2])
rgb[water] = matplotlib.colors.to_rgb('#4e7888')
mesh = Poly3DCollection(axis_faces, facecolors=rgb, edgecolors='none', zsort='average', antialiased=False)
ax.add_collection3d(mesh)
ax.set(xlim=(-550, 550), ylim=(-550, 550), zlim=(-2, 110))
ax.set_box_aspect((1, 1, .23), zoom=1.22); ax.view_init(elev=30, azim=-63); ax.set_axis_off()
ax.text(0, 25, 4, 'STARTER PLAIN', color='#e5dabd', fontsize=9)
ax.text(-185, -225, 85, 'RIDGE', color='#e5dabd', fontsize=10)
ax.text(315, -25, 60, 'EASTERN PLATEAU', color='#e5dabd', fontsize=9)
n = data['segments'] + 1
heights = p[:, 1].reshape(n, n)
extent = [-550, 550, -550, 550]
map_ax = fig.add_axes([.72, .43, .24, .39], facecolor='#111b20')
im = map_ax.imshow(heights, origin='lower', extent=extent, cmap='terrain', vmin=-2, vmax=100)
map_ax.contour(np.linspace(-550, 550, n), np.linspace(-550, 550, n), heights, levels=[5, 20, 40, 60, 80], colors='#25362d', linewidths=.6)
map_ax.scatter([0], [8], color='#ffe3a6', s=18, edgecolors='#18242b')
map_ax.plot([-140, -140], [-440, -140], color='#ffe3a6', linewidth=1.5, linestyle='--')
map_ax.set_title('Elevation / walking island', color='#eadcc0', fontsize=12, pad=12)
map_ax.set_xlabel('World X (m)', color='#aabbb5'); map_ax.set_ylabel('World Z (m)', color='#aabbb5')
map_ax.tick_params(colors='#aabbb5', labelsize=8)
profile = fig.add_axes([.72, .15, .24, .19], facecolor='#18262d')
# Interpolate on exactly the same triangular diagonal as TerrainSampler.
def sample(x, z):
    gx, gz = (x + 550) * data['segments'] / 1100, (z + 550) * data['segments'] / 1100
    ix, iz = int(gx), int(gz); u, v = gx - ix, gz - iz
    a, b, c, d = heights[iz, ix], heights[iz, ix + 1], heights[iz + 1, ix], heights[iz + 1, ix + 1]
    return a + u * (b - a) + v * (c - a) if u + v <= 1 else d + (1 - u) * (c - d) + (1 - v) * (b - d)
zs = np.linspace(-440, -140, 400); hs = [sample(-140, z) for z in zs]
profile.fill_between(zs, hs, -2, color='#879c6e', alpha=.7); profile.plot(zs, hs, color='#e0dbba', linewidth=1.7)
profile.set(xlim=(-440, -140), ylim=(-2, 110), xlabel='World Z at X = −140m', ylabel='Height (m)')
profile.set_title('Two ridges and an intervening valley', color='#eadcc0', fontsize=11, pad=12)
profile.tick_params(colors='#aabbb5', labelsize=8)
profile.xaxis.label.set_color('#aabbb5'); profile.yaxis.label.set_color('#aabbb5')
for a in [map_ax, profile]:
    for spine in a.spines.values(): spine.set_edgecolor('#45544e')
fig.text(.04, .055, 'Standalone geometry inspection • Height exaggerated 2.3× • No gameplay or FPS measurement', color='#84968f', fontsize=10)
fig.savefig(sys.argv[2], facecolor=fig.get_facecolor(), dpi=120)
