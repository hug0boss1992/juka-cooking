# Test: Standbilder aus 720p-Videos mit Real-ESRGAN schärfen (Modelle general und x4plus), Ergebnis 2x.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
from PIL import Image
from esrgan_torch import upscale
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frames')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hd')
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(src)):
    img = Image.open(os.path.join(src, name)).convert('RGB')
    for model in ('general', 'x4plus'):
        big = upscale(img, model)
        big = big.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        big.save(os.path.join(out, f"{name[:-4]}-{model}.jpg"), quality=92)
        print(name, model, big.size, flush=True)
