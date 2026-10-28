# Fixtures

`sample.mp4` is a synthetic 1,000,500-byte file (about 4 seconds at the external services' approximate rate of 250 KB/s). The external services never read the contents of a file, so any file of at least 1 KB works; this one exists so manual checks need no setup.

Pass its absolute path as `path` in the submission body. See [Test video files](../README.md#test-video-files) for instructions on generating additional files to test different sizes and processing durations.
