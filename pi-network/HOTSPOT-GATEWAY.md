# Restricted hotspot HTTPS access

Image builds install a separate NGINX stream service, running its workers as
`ezplayer-gateway`. The portal and player keep their existing HTTP service.
No general NAT or IP forwarding is enabled.

The gateway checks the TLS ClientHello server name against exact entries in
`hotspot_gateway.py`: `ezrgb.com`, `cms.ezrgb.com`, `api.ezplayer.dev`, and
`ezplayer-player-iad.fly.dev`. No wildcard for `fly.dev` or new regional services
is included. Additional login/CDN domains require a reviewed source change.
The CMS host is already used for website assets. Third-party sign-in providers,
payment pages, videos, analytics, and other sites remain blocked.

TLS is passed through to the selected hostname on TCP 443, with normal browser
certificate verification. No replacement CA, TLS termination, credential
logging, URL logging, or CONNECT/open forward proxy is installed. Unknown SNI,
missing SNI, plain traffic on the TLS listener, and client-selected destination
IPs cannot select an arbitrary upstream. DNS resolves allowed domain trees via
1.1.1.1 bound to wlan0; the TLS map still admits exact names only. DNS HTTPS/SVCB
and IPv6 responses are filtered; QUIC, direct DNS forwarding, IPv6 forwarding,
and arbitrary routing through the Pi are not enabled.

The dedicated worker UID has its own IPv4 policy route with an unreachable
fallback. Only home Wi-Fi supplies the public upstream route. Its output rules
drop non-IPv4, private/reserved destination ranges, other interfaces and ports.
Established gateway replies to hotspot clients are permitted. Forwarded traffic
from/to the hotspot is dropped even if another service enables IP forwarding.
No show-output firewall or main route is replaced. AP clients retain existing
local portal/player/SSH access to the Pi; this is not isolation from the Pi's
own intentionally exposed management services.

## Limits and hardware acceptance

This is TLS-hostname filtering, not inspection of encrypted HTTP Host headers,
URL paths or content. An allowed service's own redirects to blocked hosts fail;
if an allowed upstream itself supports cross-host forwarding/domain fronting,
that behavior cannot be excluded without TLS termination or cooperation from
the upstream. Do not describe this as an absolute website/content sandbox.
ECH using an unapproved outer name fails closed, including browser-cached ECH.
Use the normal browser for sign-in; captive mini-browsers may restrict login.

Automated tests cover the exact TLS allowlist using a real NGINX stream module,
end-to-end certificate checks, denial of lookalikes/foreign names/missing SNI,
firewall generation, fail-closed setup, route changes and existing portal routes.
Network namespace/firewall enforcement and full authenticated registration must
still be tested on a spare-card Pi. This runtime cannot exercise real Pi packet
hooks. Do not broadly add domains just to make a page load.

With cellular data and VPN off, connect only to EZPLAYER after home Wi-Fi setup:

1. Verify `/setup`, local player and Cloud remain accessible.
2. Complete the registration/login flow and open the regional cloud link.
3. Verify unrelated HTTPS sites, lookalike domains, direct public IPs and other
   ports do not connect; private home and controller hosts must not be reachable
   directly through the hotspot. The local player's own controller tools remain
   available by design.
4. Disconnect home Wi-Fi: local setup must remain accessible; external pages
   must fail. Reconnect and repeat without restarting the Pi.
5. Reboot, then repeat with Ethernet connected and disconnected. Verify show
   output still uses Ethernet and no hotspot forwarding reaches Ethernet.

Inspect `systemctl status ezplayer-gateway ezplayer-gateway-route`,
`nft list table inet ezplayer_gateway`, and `ip -4 route show table 4450`.
To disable the feature, stop/disable both gateway services. The filter remains
closed; no Internet forwarding is opened. Remove `/etc/ezplayer-gateway.conf`
and restart the network service to restore captive-only DNS behavior.
