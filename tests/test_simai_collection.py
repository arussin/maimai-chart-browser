"""Authored HTML cases for the offline public-collection reader; no downloads."""

import unittest
from unittest.mock import patch

from scripts import simai_collection
from scripts.simai_collection import (
    MAX_DEPTH,
    CollectionInputError,
    discover_indexes,
    extract_chart,
)


def wiki(body):
    return '<html><body><div id="wikibody">' + body + "</div></body></html>"


def table(rows, columns=("TITLE", "ESY", "BSC", "ADV", "EXP", "MAS", "Re:MAS")):
    header = "<tr>" + "".join("<td>" + c + "</td>" for c in columns) + "</tr>"
    return "<table><tbody>" + header + rows + "</tbody></table>"


def row_link(page, title="Synthetic Orbit"):
    return f'<a href="/simai/pages/{page}.html">{title}</a>'


def chart_row(**changes):
    return {"format": "STD", "difficulty": "EXPERT", **changes}


class SimaiCollectionTests(unittest.TestCase):
    def test_inventory_preserves_unavailable_levels_and_easy(self):
        row = (
            "<tr><td>" + row_link(910001) + "</td><td>2</td><td>4</td><td>-</td>"
            '<td style="background-color: #ffdd44;"><a href="/simai/pages/910001.html#exp">'
            "9+</a></td><td>12</td><td>-</td></tr>"
        )
        result = discover_indexes({32: wiki(table(row))})
        self.assertEqual(result["page_ids"], [910001])
        items = result["inventory_rows"]
        self.assertEqual([x["difficulty"] for x in items], ["EASY", "BASIC", "EXPERT", "MASTER"])
        self.assertEqual([x["supplied_hint"] for x in items], [False, False, True, False])
        self.assertEqual(items[2]["source_anchor"], "exp")
        self.assertEqual(items[0]["source_page_id"], items[0]["title_page_id"])
        self.assertEqual(items[0]["input_id"], items[0]["stable_input_id"])

    def test_ignores_navigation_scripts_forms_and_comment_tables(self):
        row = "<tr><td>" + row_link(910002) + "</td><td>5</td></tr>"
        content = table(row, ("TITLE", "EXP"))
        html = content + wiki(
            "<script>" + content + "</script><form>" + content + "</form>"
            '<div class="atwiki-comments">' + content + "</div>"
        )
        self.assertEqual(discover_indexes({32: html})["page_ids"], [])

    def test_deduplicates_variant_but_retains_index_associations(self):
        row = "<tr><td>" + row_link(910003) + "</td><td>8</td></tr>"
        result = discover_indexes({32: wiki(table(row + row, ("TITLE", "EXP")))})
        self.assertEqual(len(result["inventory_rows"]), 1)
        self.assertEqual(result["duplicate_associations"], 1)
        self.assertEqual(len(result["inventory_rows"][0]["associations"]), 2)

    def test_same_page_standard_and_dx_remain_distinct(self):
        content = wiki(
            table("<tr><td>" + row_link(910004) + "</td><td>8</td></tr>", ("TITLE", "EXP"))
        )
        result = discover_indexes({32: content, 808: content})
        self.assertEqual(len(result["inventory_rows"]), 2)
        self.assertEqual({r["format"] for r in result["inventory_rows"]}, {"STD", "DX"})
        self.assertEqual(result["page_ids"], [910004])
        self.assertTrue(
            all(r["source_page_formats"] == ["DX", "STD"] for r in result["inventory_rows"])
        )

    def test_event_rows_keep_attributes_and_never_infer_format(self):
        rows = (
            "<tr><td>" + row_link(910005, "[習]Synthetic Echo") + "</td><td>習</td>"
            '<td style="background-color:#ffdd44;">12?</td><td>'
            + row_link(910006, "Reference only")
            + "</td></tr>"
        )
        result = discover_indexes(
            {808: wiki(table(rows + rows, ("TITLE", "属性", "LEVEL", "COMMENT")))}
        )
        self.assertEqual(result["page_ids"], [910005])
        self.assertEqual(len(result["inventory_rows"]), 2)
        item = result["inventory_rows"][0]
        self.assertEqual(
            (item["difficulty"], item["format"], item["event_attribute"]),
            ("UTAGE", "unresolved", "習"),
        )
        self.assertEqual(item["level"], "12?")
        self.assertTrue(item["supplied_hint"])
        self.assertFalse(item["identity_resolved"])
        self.assertIsNone(extract_chart(wiki(""), item)["body"])

    def test_unheaded_and_malformed_rows_remain_explicit(self):
        content = (
            "<table><tr><td>" + row_link(910007) + "</td><td>1</td><td>-</td></tr>"
            "<tr><td>Synthetic missing page</td><td>-</td><td>8</td></tr></table>"
            + table("<tr><td>Other synthetic row</td><td>5</td></tr>")
        )
        result = discover_indexes({32: wiki(content)})
        self.assertEqual(result["page_ids"], [910007])
        self.assertEqual(len(result["inventory_rows"]), 3)
        self.assertTrue(all(r["difficulty"] == "UNRESOLVED" for r in result["inventory_rows"]))
        self.assertEqual(len(result["diagnostics"]), 3)

    def test_rejects_noncanonical_external_query_userinfo_and_zero_links(self):
        links = [
            "https://example.invalid/simai/pages/910008.html",
            "https://user@w.atwiki.jp/simai/pages/910008.html",
            "/simai/pages/0.html",
            "/simai/pages/910008.html?edit=1",
            "/simai/pages/1234567.html",
            "javascript:alert(1)",
        ]
        rows = "".join(
            f'<tr><td><a href="{link}">Synthetic</a></td><td>8</td></tr>' for link in links
        )
        result = discover_indexes({32: wiki(table(rows, ("TITLE", "EXP")))})
        self.assertEqual(result["page_ids"], [])
        self.assertEqual(len(result["inventory_rows"]), len(links))

    def test_cell_link_identifies_actual_variant_destination(self):
        row = (
            "<tr><td>"
            + row_link(910009)
            + '</td><td><a href="//w.atwiki.jp/simai/pages/910010.html#red">8</a></td></tr>'
        )
        item = discover_indexes({32: wiki(table(row, ("TITLE", "EXP")))})["inventory_rows"][0]
        self.assertEqual(
            (item["title_page_id"], item["source_page_id"], item["source_anchor"]),
            (910009, 910010, "red"),
        )

    def test_extract_preserves_tokens_and_stops_at_next_heading(self):
        html = wiki('<h2 id="exp">EXPERT</h2> (120) {4}<br>1, 2,&lt;E<br><h2>MASTER</h2>(140)3,E')
        result = extract_chart(html, chart_row(source_anchor="exp"))
        self.assertEqual(result["body"], "(120) {4}\n1, 2,<E\n")
        self.assertTrue(result["identity_resolved"])
        self.assertEqual(result["source_heading"], "EXPERT")

    def test_no_terminal_marker_or_prose_repair(self):
        result = extract_chart(
            wiki("<h2>EXPERT</h2><p>(120){4}1,</p><p>data note</p>"), chart_row()
        )
        self.assertEqual(result["body"], "(120){4}1,\ndata note\n")

    def test_comments_only_body_is_empty(self):
        html = wiki(
            "<h2>EXPERT</h2><!-- note --><script>1,E</script><form>data</form>"
            '<ul class="comment"><li>hello</li></ul><h2>MASTER</h2>2,E'
        )
        self.assertEqual(extract_chart(html, chart_row())["reason"], "empty_body")

    def test_grouped_format_headings_resolve_repeated_difficulties(self):
        html = wiki(
            "<h2>STANDARD</h2><h3>EXPERT</h3>1,E<h3>MASTER</h3>2,E<h2>DX</h2><h3>EXPERT</h3>3,E"
        )
        self.assertEqual(extract_chart(html, chart_row())["body"], "1,E\n")
        self.assertEqual(extract_chart(html, chart_row(format="DX"))["body"], "3,E\n")

    def test_last_difficulty_excludes_actual_comment_plugin_and_footer_widgets(self):
        tail = (
            '<ul><li>A synthetic comment</li></ul><div class="plugin_comment">'
            '<form class="plugin_comment_form">Comment form</form></div>'
            '<div id="atwiki-page-tags">Tags</div><div id="atwiki-liked-counter">Like</div>'
            '<div class="atwiki-page-keyword">Search</div>'
            '<div class="atwiki-lastmodify">Updated date</div>'
        )
        result = extract_chart(
            wiki("<h2>Re:MASTER</h2><p>(120){4}1,E</p>" + tail),
            chart_row(difficulty="RE:MASTER"),
        )
        self.assertEqual(result["body"], "(120){4}1,E\n")
        empty = extract_chart(wiki("<h2>Re:MASTER</h2>" + tail), chart_row(difficulty="RE:MASTER"))
        self.assertEqual(empty["reason"], "empty_body")

    def test_ordinary_list_prose_is_not_deleted_as_comments(self):
        result = extract_chart(wiki("<h2>EXPERT</h2><ul><li>Source note</li></ul>"), chart_row())
        self.assertEqual(result["body"], "Source note\n")

    def test_ambiguous_repeated_headings_without_proven_format_reject(self):
        html = wiki('<h2 id="one">EXPERT</h2>1,E<h2 id="two">EXPERT</h2>2,E')
        self.assertIsNone(extract_chart(html, chart_row())["body"])
        self.assertEqual(extract_chart(html, chart_row(source_anchor="two"))["body"], "2,E\n")

    def test_dead_anchor_requires_independent_format_evidence(self):
        html = wiki('<h2 id="one">EXPERT</h2>1,E')
        self.assertEqual(
            extract_chart(html, chart_row(source_anchor="missing"))["reason"],
            "heading_format_unresolved",
        )
        result = extract_chart(html, chart_row(source_anchor="EXPERT", source_page_formats=["STD"]))
        self.assertEqual(result["body"], "1,E\n")
        self.assertEqual(result["anchor_status"], "stale")
        self.assertEqual(result["identity_resolution"], "unique_heading")
        self.assertTrue(result["identity_resolved"])

    def test_conflicting_or_duplicate_anchor_does_not_fall_back(self):
        html = wiki('<h2 id="one">EXPERT</h2>1,E<h2 id="EXPERT">MASTER</h2>2,E')
        self.assertEqual(
            extract_chart(html, chart_row(source_anchor="EXPERT", source_page_formats=["STD"]))[
                "reason"
            ],
            "anchor_target_mismatch",
        )
        self.assertEqual(
            extract_chart(
                wiki('<h2 id="x">EXPERT</h2>1,E<h2 id="x">EXPERT</h2>2,E'),
                chart_row(source_anchor="x"),
            )["reason"],
            "ambiguous_heading_anchor",
        )

    def test_stale_anchor_mixed_formats_require_explicit_heading_scope(self):
        row = chart_row(source_anchor="EXPERT", source_page_formats=["DX", "STD"])
        self.assertEqual(
            extract_chart(wiki('<h2 id="generated">EXPERT</h2>1,E'), row)["reason"],
            "heading_format_unresolved",
        )
        self.assertEqual(
            extract_chart(wiki("<h2>EXPERT</h2>1,E<h2>EXPERT</h2>2,E"), row)["reason"],
            "ambiguous_heading",
        )
        html = wiki("<h2>STANDARD</h2><h3>EXPERT</h3>1,E<h2>DX</h2><h3>EXPERT</h3>2,E")
        self.assertEqual(extract_chart(html, row)["body"], "1,E\n")
        self.assertEqual(extract_chart(html, row | {"format": "DX"})["body"], "2,E\n")

    def test_named_anchor_before_heading_and_format_mismatch(self):
        html = wiki('<h2>DX</h2><a name="red"></a>\n<h3>EXPERT</h3>1,E')
        self.assertEqual(
            extract_chart(html, chart_row(format="DX", source_anchor="red"))["body"], "1,E\n"
        )
        self.assertEqual(
            extract_chart(html, chart_row(source_anchor="red"))["reason"], "heading_format_mismatch"
        )

    def test_atwiki_empty_wrapped_named_anchor_binds_to_next_heading(self):
        html = wiki(
            '<div>\n<a id="EXPERT" name="EXPERT" href="#EXPERT"></a>\n</div>'
            '<h2 id="generated">EXPERT</h2>1,E'
        )
        result = extract_chart(html, chart_row(source_anchor="EXPERT"))
        self.assertEqual(result["body"], "1,E\n")
        self.assertEqual(result["anchor_status"], "matched")
        self.assertEqual(result["identity_resolution"], "anchor")
        conflict = wiki(
            '<div><a name="EXPERT"></a>Intervening visible text</div>'
            '<h2 id="generated">EXPERT</h2>1,E'
        )
        self.assertEqual(
            extract_chart(conflict, chart_row(source_anchor="EXPERT"))["reason"],
            "anchor_target_mismatch",
        )

    def test_terminal_named_anchor_crosses_container_closure_and_blank_break(self):
        html = wiki(
            '<h2>BASIC</h2><div>Earlier body<a name="EXPERT"></a></div>'
            '<br>\n<h2 id="generated">EXPERT</h2>1,E'
        )
        result = extract_chart(html, chart_row(source_anchor="EXPERT"))
        self.assertEqual(result["body"], "1,E\n")
        self.assertEqual(result["anchor_status"], "matched")
        for intervening in ["Visible text", "<ul><li>Source note</li></ul>"]:
            conflict = wiki(
                '<div><a name="EXPERT"></a></div>'
                + intervening
                + '<h2 id="generated">EXPERT</h2>1,E'
            )
            self.assertEqual(
                extract_chart(conflict, chart_row(source_anchor="EXPERT"))["reason"],
                "anchor_target_mismatch",
            )

    def test_structure_bounds_and_missing_content_region(self):
        for html in ["<p>outside</p>", wiki("") + wiki(""), wiki("<div>" * (MAX_DEPTH + 1))]:
            with self.assertRaises(CollectionInputError):
                discover_indexes({32: html})
        with self.assertRaises(CollectionInputError):
            discover_indexes({99: wiki("")})

    def test_one_page_cache_reuses_tree_and_evicts_previous_page(self):
        simai_collection._prepared_page.cache_clear()
        html = wiki("<h2>EXPERT</h2>1,E<h2>MASTER</h2>2,E")
        with patch.object(
            simai_collection, "_Document", wraps=simai_collection._Document
        ) as parser:
            extract_chart(html, chart_row())
            extract_chart(html, chart_row(difficulty="MASTER"))
            self.assertEqual(parser.call_count, 1)
            extract_chart(wiki("<h2>EXPERT</h2>3,E"), chart_row())
            self.assertEqual(simai_collection._prepared_page.cache_info().currsize, 1)
            extract_chart(html, chart_row())
            self.assertEqual(parser.call_count, 3)


if __name__ == "__main__":
    unittest.main()
