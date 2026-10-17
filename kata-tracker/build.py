"""Builds Index.html (pasted into the Kata Tracker's Apps Script project) from Index.src.html,
inlining the dojo logo so the page needs no other files."""
import base64, pathlib
here = pathlib.Path(__file__).parent
logo = base64.b64encode((here.parent / "logo-96.png").read_bytes()).decode()
src = (here / "Index.src.html").read_text()
assert "__LOGO__" in src
(here / "Index.html").write_text(src.replace("__LOGO__", "data:image/png;base64," + logo))
print("Index.html", len((here / "Index.html").read_text()), "chars")
