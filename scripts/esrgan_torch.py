"""Real-ESRGAN über PyTorch auf dem Prozessor (für den GitHub-Lauf ohne Grafikkarte).

Modelle werden beim ersten Aufruf von den offiziellen Real-ESRGAN-Releases geladen und per
Prüfsumme kontrolliert. „general“ (realesr-general-x4v3) ist schnell und für echte Fotos gemacht,
„x4plus“ (RealESRGAN_x4plus) ist gründlicher, aber deutlich langsamer.
Benötigt: pip install torch (CPU) spandrel numpy pillow
"""
import hashlib
import os
import urllib.request

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

MODELS = {
    'general': ('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
                '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292'),
    'x4plus': ('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
               '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1'),
}


def load_model(name, cache):
    url, sha = MODELS[name]
    path = os.path.join(cache, os.path.basename(url))
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        urllib.request.urlretrieve(url, path + '.part')
        os.replace(path + '.part', path)
    digest = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    if digest != sha:
        os.remove(path)
        raise RuntimeError(f'Prüfsumme von {os.path.basename(path)} stimmt nicht')
    return ModelLoader().load_from_file(path).eval()


@torch.no_grad()
def upscale(img, name='general', cache=None, tile=256, pad=16):
    torch.set_num_threads(os.cpu_count() or 4)
    model = load_model(name, cache or os.path.join(os.path.expanduser('~'), '.cache', 'juka-esrgan'))
    scale = model.scale
    x = torch.from_numpy(np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
    _, _, h, w = x.shape
    out = torch.zeros((1, 3, h * scale, w * scale))
    # In Kacheln rechnen, damit der Speicher reicht; Ränder überlappen und werden abgeschnitten.
    for top in range(0, h, tile):
        for left in range(0, w, tile):
            t0, l0 = max(top - pad, 0), max(left - pad, 0)
            t1, l1 = min(top + tile + pad, h), min(left + tile + pad, w)
            result = model(x[:, :, t0:t1, l0:l1])
            bottom, right = min(top + tile, h), min(left + tile, w)
            out[:, :, top * scale:bottom * scale, left * scale:right * scale] = result[
                :, :, (top - t0) * scale:(bottom - t0) * scale, (left - l0) * scale:(right - l0) * scale]
    array = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(array)
