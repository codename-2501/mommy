# THE LOOKBACK — my paintings, original design & interaction, local CMS

The real cloned THE LOOKBACK site — original design, motion and interactions —
rendered entirely from MY content, editable in a local admin. No external CMS.

## Run
- Double-click **`start-admin.bat`**  (Site: http://localhost:8082/ · Admin: /admin/)
- or: `python admin_server.py 8082`

## How the detail works (no flash, native motion)
The detail's data is normally fetched live from DatoCMS. The server rewrites the
app JS so that endpoint points at a local `/gql` that returns OUR slide content
in DatoCMS's shape — so the native detail renders our data from the first paint:
- zero flash, original entrance motion / flip / left image-strip preserved
- each slide has a unique url `/articles/tlb-<id>` → per-slide detail (1→1)
- the left prev/current/next strip is corrected to our adjacent works (data only,
  DOM untouched → motion intact); clicks move through works in order.

## Admin (/admin/)
- **슬라이드**: image, labels, detail title/description, add/dup/delete/reorder
- **🎞 미디어**: per-slide detail body — add images (library) + YouTube videos,
  captions, reorder, delete → rendered in the ORIGINAL article format
- **이미지**: upload / delete library images
- **텍스트**: edit any page's copy

## Key files
- `admin_server.py` — site + admin + `/gql` (local DatoCMS stand-in) + JS rewrite
- `tlb-admin.js` — home slide swap + related-strip ordering (motion-preserving)
- `content.json` — all editable content (slides + media + texts)
- `gql_template.json` — captured response shape used to build `/gql`
