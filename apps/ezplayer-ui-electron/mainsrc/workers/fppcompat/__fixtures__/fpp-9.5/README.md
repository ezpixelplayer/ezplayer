`/api/player/status` from FPP 9.5 in Docker (packages/integration-tests/docker/fpp)
while playing a one-entry playlist of a sequence+media ("both") entry created
through the API. Unlike the 9.2 capture, the playing `media` half reports
`type: "media"` and the media player's clock (`mediaSeconds`, `secondsTotal`,
`subSecondsElapsed`, …); entries created through the API carry no
`duration`, `timecode` or `videoOut`, which FPP's UI adds when it saves.
