# Fixtures

`sample.mp4` is a synthetic 1,000,500-byte file (about 4 seconds at the external services' approximate rate of 250 KB/s). The external services never read the contents of a file, so any file of at least 1 KB works; this one exists so manual checks need no setup.

The service reads videos only from its videos directory, `data/videos/` by default. To submit this file, copy it there with `mkdir -p data/videos && cp fixtures/sample.mp4 data/videos/` and pass `"path": "sample.mp4"`. See [Test video files](../README.md#test-video-files) for instructions on generating additional files to test different sizes and processing durations.
