"""Static identifiers shared by the backend."""

# Loadout sockets (same IDs across every weapon).
SOCKET_SKIN = "bcef87d6-209b-46c6-8b19-fbe40bd95abc"
SOCKET_SKIN_LEVEL = "e7c63390-eda7-46e0-bb7a-a6abdacd2433"
SOCKET_CHROMA = "3ad1b2b2-acdb-4524-852f-954a76ddae0a"

WEAPON_MELEE = "2f59173c-4bed-b6c3-21ed-d610619939ac"
WEAPON_VANDAL = "9c82e19d-4575-0200-1a81-3eacf00cf872"
WEAPON_PHANTOM = "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a"
WEAPON_OPERATOR = "a03b24d3-4319-996d-0f8c-94bbfba1dfc7"
WEAPON_SHERIFF = "e336c6b8-418d-9340-d77f-7a9e4cfe0702"

# Base64 JSON describing a Windows PC client, expected by Riot's remote APIs.
CLIENT_PLATFORM = (
    "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6"
    "ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIkludGVsIg0KfQ=="
)

# Riot region -> (glz region, shard)
REGIONS = {
    "na": ("na", "na"),
    "latam": ("latam", "na"),
    "br": ("br", "na"),
    "eu": ("eu", "eu"),
    "ap": ("ap", "ap"),
    "kr": ("kr", "kr"),
    "pbe": ("na", "pbe"),
}

# Before Episode 5 Act 1 (Ascendant introduction), tiers >= 21 were Immortal/Radiant
# and must be shifted by 3 to match today's numbering.
ASCENDANT_RELEASE_MS = 1655856000000  # 2022-06-22

# Worker cadence (seconds)
TICK_MENUS = 5
TICK_PREGAME = 3
TICK_INGAME = 5
TICK_OFFLINE = 5
PROFILE_REFRESH = 120
HISTORY_REFRESH = 90
HISTORY_REFRESH_INGAME = 600
PLAYER_CACHE_TTL = 600
MAX_DETAILS_PER_SYNC = 10
MAX_UPGRADES_PER_SYNC = 5
DETAILS_SPACING = 0.6
