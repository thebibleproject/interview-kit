# Bible Study Notebook: end-to-end tests

End-to-end tests for the Bible Study Notebook Android app, written with [Maestro](https://maestro.dev).

## Prerequisites

- **Java 17 or newer.** Check with `java -version`.
- **An Android emulator,** from Android Studio's Device Manager, with `adb` on your PATH. Check with `adb devices`.
- **Maestro CLI:**

  ```sh
  curl -Ls "https://get.maestro.mobile.dev" | bash
  ```

  Then open a new terminal and check with `maestro --version`. See the [Maestro installation docs](https://docs.maestro.dev) for other options.

- **Maestro Studio** (optional, but useful for finding elements). This is a desktop app; download the installer from [maestro.dev](https://maestro.dev/).

## Setup

1. Start the emulator and wait for the home screen.
2. The app's APK is already at `app/bible-study-notebook.apk`.
3. Install it:

   ```sh
   ./scripts/install-app.sh
   ```

## Running tests

```sh
./scripts/run-tests.sh                                       # every test
./scripts/run-tests.sh maestro --include-tags smoke          # the smoke set
./scripts/run-tests.sh maestro/tests/topics                  # one folder
./scripts/run-tests.sh maestro/tests/topics/rename_topic.yaml   # one test
```

The script calls `maestro test` and writes:

- `reports/junit.xml`, a JUnit report of the run
- `reports/debug/`, Maestro's logs, plus screenshots of any failures

You can also call Maestro directly, for example `maestro test maestro/tests/topics/rename_topic.yaml`.

### Exploring the app

To find an element's ID or text, or to try steps interactively, use **Maestro Studio**, a desktop app. Download the installer from [maestro.dev](https://maestro.dev/). With the emulator running, Studio shows the emulator's screen and the details of the element under your cursor.


## Project structure

```
app/                  Put the APK here (not committed)
maestro/
  config.yaml         Which flows run
  tests/              Test flows, by feature
  subflows/           Reusable steps
reports/              Run output (not committed)
scripts/
  install-app.sh      Installs the APK on the emulator
  run-tests.sh        Runs Maestro and writes reports
```

## How to submit your work

1. Start your own private repository from the challenge repo template.
2. Commit your work on top of that first commit. Please keep it private and don't open pull requests against it.
3. Once completed, share a private GitHub repository with `@jeffikus`, `@tiffanywilson`.
4. Email the hiring manager to confirm your submission, including the GitHub repo link and the summary video.
5. We'll reply with a confirmation we've received your submission within a week and give you an anticipated timeline for review.