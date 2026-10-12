"""Localized launch help has working safe guide links and matching section anchors."""

import unittest
from html.parser import HTMLParser
from importlib.resources import files

from maimai_intelligence.player_help import _render_markdown


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = []
        self.links = []
        self.tags = []

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        self.tags.append(tag)
        if "id" in values:
            self.anchors.append(values["id"])
        if tag == "a" and "href" in values:
            self.links.append(values)


class PlayerHelpTests(unittest.TestCase):
    def test_launch_services_have_real_anchors_and_external_guide_links_in_every_locale(self):
        for suffix in ("", ".zh-Hans", ".ko", ".ja", ".id"):
            with self.subTest(suffix=suffix):
                source = (
                    files("maimai_intelligence.assets")
                    .joinpath(f"import-help/README{suffix}.md")
                    .read_text("utf-8")
                )
                rendered = _render_markdown(source)
                parsed = Links()
                parsed.feed(rendered)
                self.assertEqual(
                    set(parsed.anchors),
                    {
                        "session-report",
                        "maishift",
                        "kamaitachi",
                        "diving-fish",
                        "direct-connections",
                    },
                )
                self.assertEqual(len(parsed.anchors), 5)
                urls = {link["href"] for link in parsed.links}
                self.assertIn("https://maimai.shiftpsh.com/en/guide", urls)
                self.assertIn("https://maimai.diving-fish.com/", urls)
                self.assertIn("https://kamai.tachi.ac/import", urls)
                self.assertIn("https://auth.diving-fish.com/apps", urls)
                self.assertIn("对非网页查询的成绩使用掩码", source)
                self.assertNotRegex(
                    source, r"LXNS|BATCH-MANUAL|AquaDX|JiETNG|DXRating|Tomomai|mai-tools"
                )
                self.assertNotIn("<script", rendered)
                self.assertIn("ol", parsed.tags)
                self.assertIn("strong", parsed.tags)
                for link in parsed.links:
                    self.assertTrue(link["href"].startswith("https://"))
                    self.assertEqual(link["rel"], "noopener noreferrer")

    def test_raw_markup_and_unsafe_link_schemes_or_authority_are_never_executable(self):
        source = (
            '<script>alert(1)</script>\n\n<a id="unexpected"></a>\n\n'
            "[bad](javascript:alert(1)) [bad](http://example.test) "
            "[bad](https://user:password@example.test/) "
            "[bad](https://[broken/) [safe](https://example.test/?a=1&b=2)"
        )
        rendered = _render_markdown(source)
        parsed = Links()
        parsed.feed(rendered)
        self.assertNotIn("script", parsed.tags)
        self.assertEqual(parsed.anchors, [])
        self.assertEqual([link["href"] for link in parsed.links], ["https://example.test/?a=1&b=2"])


if __name__ == "__main__":
    unittest.main()
