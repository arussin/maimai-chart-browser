"""First-party social metadata shared by the public shell and localized pages."""

from html import escape


def social_metadata(title: str, description: str, url: str) -> str:
    values = {
        "og:type": "website",
        "og:site_name": "maimai.party",
        "og:title": title,
        "og:description": description,
        "og:url": url,
        "og:image": "https://maimai.party/og-image.png",
        "og:image:width": "1200",
        "og:image:height": "630",
        "og:image:type": "image/png",
        "og:image:alt": "maimai.party",
        "twitter:card": "summary_large_image",
        "twitter:title": title,
        "twitter:description": description,
        "twitter:image": "https://maimai.party/og-image.png",
        "twitter:image:alt": "maimai.party",
    }
    return "".join(
        f'<meta {"property" if key.startswith("og:") else "name"}="{key}" '
        f'content="{escape(value, quote=True)}">\n'
        for key, value in values.items()
    )
