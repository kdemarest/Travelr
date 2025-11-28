TRIP PLANNER V1 – DESIGN DOCUMENT
---------------------------------

1. OVERVIEW

Personal travel planner.

Backend: NodeJS + TypeScript.
Frontend: TypeScript + lit web components.
Environment: VSCode and Chrome, plus nodemon to restart the server as needed
Storage: bare files in a data/ directory

Persistent storage: a journal file named "<tripName>.json".
The journal contains ONLY slash-commands, one per line.
The in-memory TripModel is rebuilt by replaying the journal on startup.
The journal is the single authoritative source.
The in-memory JSON is authoritative only at runtime.

All modifications MUST occur through slash-commands.

---------------------------------

2. IN-MEMORY DATA MODEL

TripModel:
  tripName: string
  activities: Activity[]

Activity:
  uid: string            (12-character opaque ID, generated automatically)
  activityType: string   (flight, lodging, transport, visit, meal, hike, etc.)
  name: string           (required; may be blanked)
  date: string           (YYYY-MM-DD, required)
  time: string           (HH:mm or "")

Optional fields:
  duration: number (in minutes)
  contactName: string
  contactPhone: string
  contactEmail: string
  status: idea | planned | booked | completed | cancelled
  price: number
  currency: string
  paymentMade: boolean
  paymentMethod: string
  paymentDate: string    (YYYY-MM-DD)
  notesUser: string
  notesAi: string

Rules:
- Required fields (name, date, time) must exist but may be "".
- Fields are never deleted. Blank values represent "none".
- Start and end dates of the entire trip are derived, not stored.
- Day groupings are derived from filtering by "date".

---------------------------------

3. JOURNAL AND COMMANDS

Journal file: data/<tripName>.json  
Format: plain UTF-8 text.  
One slash-command per line.
Replay order is the order of truth.

Command grammar:
- All commands begin with "/".
- Arguments use key=value.
- Strings containing spaces MUST be quoted.
- Empty string is "".
- String argument values are JSON string literals:
   - Embedded newlines using \n
   - Internal quotes are escaped using \"
   - Unicode
   - Backslashes using \\
- Numbers are unquoted.
- Booleans use true/false.
- Dates MUST be quoted "YYYY-MM-DD".
- Times MUST be quoted "HH:mm" or "".

Commands:

(1) /add
    Creates a new activity.
    Server generates uid.

    Syntax:
    /add activityType=<type> date="<YYYY-MM-DD>" time="<HH:mm or empty>" name="<string>" [other key=value pairs]

    Example:
    /add activityType=flight date="2025-03-01" time="09:15" name="DFW to NRT" price=850 currency=USD status=booked paymentMade=true paymentMethod="credit-card" paymentDate="2025-01-10"

(2) /edit
    Modifies an existing activity identified by uid.
    Fields are replaced exactly.
    Setting a field to "" blanks it.

    Syntax:
    /edit uid=<12-char-id> field1=value1 field2=value2 ...

    Example:
    /edit uid=Ab12Cd34Ef56 status=planned paymentMade=true paymentDate="2025-02-01"
    /edit uid=Ab12Cd34Ef56 contactPhone=""

(3) /delete
    Removes an activity.

    Syntax:
    /delete uid=<12-char-id>

(4) /moveday
    Moves all activities from one date to another.

    Syntax:
    /moveday from="<YYYY-MM-DD>" to="<YYYY-MM-DD>"

    Effect:
    For each activity where date == from, set date = to.

(5) /model
  Lists or switches the ChatGPT model used for AI assistance.

  Syntax:
  /model                   (lists supported models and shows the active one)
  /model <modelName>       (sets the active model if supported)

  Effect:
  Influences which GPT model Travelr uses for subsequent AI calls.

(6) /websearch
  Runs an external web search (currently DuckDuckGo) without exposing raw results to the user.

  Syntax:
  /websearch "search terms"
  /websearch query="search terms"

  Effect:
  Performs a background query that can later inform AI responses.

(7) /renormalize
  Maintenance-only command for human operators.

  Syntax:
  /renormalize

  Effect:
  Replays every journal in `data/`, emits normalized `.tmp` copies alongside the originals, and logs any skipped lines. The chatbot must never issue this command.

---------------------------------

4. BACKEND (NODEJS + TYPESCRIPT)

Modules:

uid.ts
  generateUid(): string

parser.ts
  parseCommandLine(line): ParsedCommand | null

ParsedCommand union types:
  type "add", args AddArgs
  type "edit", args EditArgs
  type "delete", args DeleteArgs
  type "moveday", args MoveDayArgs

reducer.ts
  applyCommand(model, command): model
  Pure, no IO.

journal.ts
  loadJournal(tripName): string[]
  appendCommand(tripName, line): void
  rebuildModel(tripName): TripModel
    - Start with empty model.
    - Replay parsed commands in order.

server.ts
  HTTP API endpoints.

API:

GET /api/trip/:tripName/model
  Returns current TripModel (rebuilt or cached).

POST /api/trip/:tripName/command
  Body: { command: string }
  Steps:
    - Append command to journal file.
    - Parse and apply.
    - Return updated model.

---------------------------------

5. FRONTEND (LIT WEB COMPONENTS)

Components:

<trip-app>
  Holds TripModel.
  Provides sendCommand(command).

<panel-plan> (left column)
  Input: list of activities.
  Groups by date.
  User selects day.

<panel-day> (middle top)
  Input: activities filtered by selected date.
  Timeline sorted by time.
  Clicking an activity selects it.

<panel-activity> (middle bottom)
  Input: selected activity.
  Shows editable fields.
  Save button emits an /edit command.

<panel-detail> (right column)
  Shows notesUser, notesAi, links.
  Contains chat/command box in v1.

Chat box:
  If text starts with "/", it's a command.
  Otherwise (v1) ignore or show "Not implemented".

Layout: three columns via CSS flex.

---------------------------------

6. AI INTERACTION (V1)

AI is allowed to output slash-commands inline.
User sees the commands directly.
Frontend sends them to POST /api/.../command.
No other write path exists.

---------------------------------

7. OPEN ITEMS FOR FUTURE VERSIONS

- Optional day objects for explicit "city" and "mainActivity".
- Reordering within a day independent of "time".
- Photo/attachment handling.
- AI-based suggestions and summaries.

---------------------------------

END OF DOCUMENT
