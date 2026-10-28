# Media processing system: delivery to partners

Extend an existing media processing service to support multiple partners and changing delivery destinations. Plan on about **4 hours**; prioritize the core flow and document unfinished work.

## The scenario

Your organization makes videos and shares them with partners. Partners are organizations that publish the videos on their own platforms.

You are taking over a media processing service. It was custom-built for the organization's first partner, GoodPeople, and has run in production for a year. It was largely vibe-coded, with a single engineer guiding its development.

It currently supports:

- A client can submit the path of a video file and a list of languages.
- The service retrieves metadata from the file, takes 5 screen captures, and produces transcripts in each of the requested languages.
- The video file and all of its derived assets are uploaded to three object stores: `primary` (the system's own storage), `cdn`, and `archive`. `cdn` and `archive` are GoodPeople's object stores.
- A client can fetch the status of a submission to understand its progress and ultimate outcome.

The service's code is in `src/`. [`DESIGN.md`](DESIGN.md) is the previous team's design doc. It lists the service's three endpoints and describes the lifecycle of a submission, the data model, the decisions they made, and the limits they knew about. Read both before changing anything.

> [!NOTE]
> We care about how you work with a system you didn't design, not the depth of your media processing expertise. `external/` contains local stand-ins for every media tool and third-party service. See [`external/README.md`](external/README.md).

## The new requirements

Your organization wants to share its videos with more partners. Each new partner requires a different set of languages for the videos and transcripts it publishes. Most videos go to several partners. The content team submits a video once for each partner, along with that partner's required transcript languages. A partner decides where its videos are stored.

1. **Every submission names a partner.** `POST /videos` takes a `partner` field:

    ```http
    POST /videos
    Content-Type: application/json

    { "partner": "acme", "path": "/absolute/path/to/video.mp4", "languages": ["en", "es"] }
    ```

2. **Each partner has its own destinations.** A destination is a bucket the partner owns at your storage vendor. It has a name, a tier, and a flag that says whether it is required. A partner replaces its whole list at once:

    ```http
    PUT /partners/acme/destinations
    Content-Type: application/json

    {
      "destinations": [
        { "name": "acme-cdn", "tier": "medium", "required": true },
        { "name": "acme-cold", "tier": "slow", "required": false }
      ]
    }
    ```

   Bucket names are unique across the vendor, so a destination's name identifies one partner's bucket. Open a destination with `openStore`. See [`external/README.md`](external/README.md).

3. **`primary` stays.** Every asset of every video still goes to `primary`, and `primary` is always required. It is not a destination of any partner.

4. **Destinations change over time.** When a partner adds a destination, every video already sent to that partner must be delivered there, not only new videos. A partner that moves to a new bucket expects its whole catalog there. When a partner removes a destination, the service stops delivering to it. Objects already delivered there can stay.

5. **Existing data belongs to GoodPeople.** Every submission made before your change was for the partner `GoodPeople`. Its destinations are `cdn` (tier `medium`, required) and `archive` (tier `slow`, not required). A database written by the current service must keep working after your change.

6. **Source files don't stay.** The content team's shared drive is running out of space. A cleanup job now deletes a source file sometime after the first submission that uses it succeeds, because `primary` then holds a copy. Assume the file at `path` exists only until that cleanup.

### Submission state

A submission succeeds once every asset is in `primary` and in each of its partner's required destinations. You decide what a submission's state means when its partner's destinations change after it was submitted. Write the decision down.

### Expected scale

- About 50 partners, each with 1 to 5 destinations.
- The largest partner has been sent 20,000 videos.
- Adding a destination to the largest partner must not hold up new submissions for any partner.

## Your task

Start by reading the existing implementation and `DESIGN.md`. Adapt the service to the requirements above.

### Must-haves

1. A partner can set its destinations, and a new submission is delivered to `primary` and to each of that partner's destinations.
2. A submission's state follows each destination's `required` flag, and its status shows every asset at every destination.
3. When a partner adds a destination, the videos already sent to that partner are delivered there. If you stop the process partway through and start it again, delivery resumes without redoing finished work.
4. A database written by the current service still works after your change.

Work within about **4 hours**; no more than 8. If you do not finish, explain what works, what remains, and what you would tackle next in `NOTES.md`.

## What we're looking for

The new requirements invalidate some of the decisions, invariants, and assumptions that went into the design of the existing system. We want to see how you interact with that existing system and adapt it to the new requirements - what you keep, what you change, and why.

We will focus on:

- How well you understand the existing system and identify assumptions that no longer hold.
- The reliability and maintainability of your changes, supported by focused tests.
- How clearly you explain tradeoffs, prioritization, and a safe migration approach.

## Scope and constraints

- Real media processing, real cloud services, authentication, a UI, and deployment are out of scope.
- Any additional npm packages are fine. You may change the persistence layer. Prefer options that a reviewer can run with minimal setup. If running your project takes more than `npm install && npm start`, document the steps.
- Treat `external/` as third-party services that you don't control. You may configure them, but don't change their behavior.
- You may use AI coding tools, but you should understand the changes you've made and be able to answer questions about the system.

## Getting started

```sh
npm install          # installs dependencies
npm test             # runs tests
npm start            # starts the service
npm run typecheck    # checks types
npm run lint         # lints 
npm run format       # formats code
```

The repo contains:

- `src/`, the current service. [`DESIGN.md`](DESIGN.md) describes it. It keeps its database at `data/service.db`. Set `DB_PATH` to use another file.
- `external/`, local stand-ins for the third-party services. See [`external/README.md`](external/README.md).
- `fixtures/`, including `sample.mp4` for testing.

## Test video files

A sample video is provided at [`fixtures/sample.mp4`](fixtures/sample.mp4). It represents about 4 seconds of video.

The external services don't inspect video contents. They treat any regular file of at least 1 KB as a video and derive its duration from its size at about 250 KB per second. You don't need real video files.

To test different file sizes and processing durations, generate additional files with `npm run create-video`:

```sh
npm run create-video -- lessons/intro.mp4      # 10 MB, ~40 seconds
npm run create-video -- lessons/long.mp4 100   # 100 MB, ~7 minutes
```

The path argument is relative to `data/videos/`. The size is in megabytes, defaults to 10, and is at most 100. The script won't overwrite an existing file.

Larger files take longer to transcribe and upload. Each store keeps a full copy of every original it receives under `data/stores/`, so a 100 MB file delivered to the three built-in stores uses another 300 MB of disk.

## Deliverables

- Your source code, with instructions for running it, as a git repository that includes your commit history. A zip of the project including its `.git` folder works, as does a private repository shared with us. Leave out `node_modules/` and `data/`.
- Tests for the parts you think matter most.
- A `NOTES.md` that covers:
  - a brief overview of what you changed to support the new requirements
  - the lifecycle of a submission after your change
  - a description of how your system handles a partner adding a new storage destination
  - what you would change before running this in production at scale
  - what you would do with more time
  - which AI tools you used, how you used them, and what you used them for

### Further questions to consider

A real-world system has to hold up under many conditions. Keep these questions in mind as you work - we'll come back to them in the interview.

- What is a submission's state when its partner adds a required destination after the submission succeeded?
- How does a backfill of 20,000 videos make progress, survive a restart, and stay out of the way of new submissions? How would an operator know how far along it is?
- The content team submits the same file for two partners with different languages. Which work is shared between them, and which is not?
- A partner removes a destination while uploads to it are in flight. What happens to those uploads?
- The source file is gone. Which assets can the service still deliver, and from where? How would the content team send that video to a new partner?
- How does the existing code have to change, and in what order would you ship those changes to a running service?
