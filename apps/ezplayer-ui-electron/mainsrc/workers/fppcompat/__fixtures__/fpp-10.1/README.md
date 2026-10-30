Responses captured from FPP 10.x in Docker, idle and while playing a
one-sequence playlist. The unit tests compare the structure of EZPlayer's
payloads (key names and JSON types) against these, not the values.

`idle.*` is a freshly booted FPP that has played nothing; `stopped.*` is the
same FPP idle again after a playlist ran, keeping some of that playlist's
state (`playlistInfo` is an object, not `null`). EZPlayer matches `stopped`:
the steady state of a running player.
