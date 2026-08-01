#!/usr/bin/env python3
"""
Собирает preview.html из index.html.

index.html — боевой файл, он и едет на хостинг.
preview.html — тот же сайт для просмотра по ссылке на claude.ai.

Единственный источник правды — index.html в этом репозитории. Он же уезжает
на GitHub Pages. Превью собирается из него, поэтому разойтись они не могут.

Отличия превью продиктованы политикой безопасности площадки: она запрещает
странице обращаться к внешним хостам и к соседним файлам. Поэтому здесь:
  * снимается обёртка <!doctype>/<html>/<head> — площадка добавляет свою;
  * убирается разметка для поисковиков (в превью не нужна);
  * карта Яндекса подменяется заглушкой — iframe всё равно не загрузится;
  * картинки из img/ вшиваются прямо в страницу (data:), иначе не покажутся.

Никакого ручного редактирования preview.html: любое изменение вносится
в index.html, потом запускается этот скрипт.
"""
import base64
import io
import json
import mimetypes
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "index.html"
DST = HERE / "preview.html"

MAP_STUB = '''      <div class="map">
        <div class="map__stub">
          <strong>Здесь карта Яндекса</strong>
          <span>В превью она не грузится: площадка блокирует внешние адреса.
          В index.html на этом месте рабочий код карты — на хостинге она откроется.</span>
        </div>
      </div>'''


MAX_EDGE = 900     # больше в превью не нужно, а вес растёт заметно
MAX_BYTES = 120_000  # base64 раздувает ещё на треть, поэтому тяжёлое пережимаем


def inline_images(html: str) -> tuple[str, int, int]:
    """Заменяет src="img/..." на data:-строку. Возвращает html, сколько вшито, байт."""
    done = 0
    total = 0

    def repl(m: re.Match) -> str:
        nonlocal done, total
        rel = m.group(1)
        path = HERE / rel
        if not path.is_file():
            print(f"！ нет файла {rel} — оставлен как есть", file=sys.stderr)
            return m.group(0)

        data = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

        # крупные растры ужимаем, svg и мелочь оставляем как есть
        if mime.startswith("image/") and mime != "image/svg+xml":
            try:
                from PIL import Image

                im = Image.open(io.BytesIO(data))
                if max(im.size) > MAX_EDGE or len(data) > MAX_BYTES:
                    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
                    buf = io.BytesIO()
                    im.convert("RGB").save(buf, "JPEG", quality=78, optimize=True)
                    data, mime = buf.getvalue(), "image/jpeg"
            except Exception as exc:                     # noqa: BLE001
                print(f"！ {rel}: не удалось ужать ({exc}), вшиваю как есть", file=sys.stderr)

        done += 1
        total += len(data)
        return f'src="data:{mime};base64,{base64.b64encode(data).decode()}"'

    return re.sub(r'src="(img/[^"]+)"', repl, html), done, total


def main() -> int:
    html = SRC.read_text(encoding="utf-8")

    # проверяем, что разметка для поисковиков не сломана
    ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    if not ld:
        print("！ не найден блок application/ld+json", file=sys.stderr)
        return 1
    data = json.loads(ld.group(1))

    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    style = re.search(r"<style>.*?</style>", html, re.S).group(0)
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)

    body = re.sub(r'<script type="application/ld\+json">.*?</script>', "", body, flags=re.S)

    # комментарии-подсказки в превью не нужны, а примеры вида <img src="img/...">
    # внутри них сбивают вшивание картинок
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)

    map_block = re.search(r'      <div class="map">.*?\n      </div>', body, re.S)
    if map_block:
        body = body.replace(map_block.group(0), MAP_STUB)
    else:
        print("！ блок карты не найден — превью соберётся, но проверьте вёрстку", file=sys.stderr)

    body, pics, pic_bytes = inline_images(body)

    DST.write_text(f"<title>{title}</title>\n{style}\n{body.strip()}\n", encoding="utf-8")

    print(f"preview.html собран: {DST.stat().st_size / 1024:.1f} КБ")
    print(f"  услуг в разметке: {len(data.get('makesOffer', []))}")
    print(f"  отзывов в разметке: {len(data.get('review', []))}")
    print(f"  карта в превью: заглушка, в index.html: {'iframe' if 'map-widget' in html else 'НЕТ'}")
    print(f"  вшито картинок: {pics} ({pic_bytes / 1024:.1f} КБ)")
    left = len(re.findall(r'class="ph[ "]', body))
    print(f"  осталось заглушек под фото: {left}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
