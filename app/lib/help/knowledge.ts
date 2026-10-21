// The help assistant's brain: everything it knows about the tool, dropped whole into its system
// prompt (one stable, cacheable string). The current switches (intake paused, AI drafts on or off)
// are NOT written here: /api/help reads them from Settings on every question and sends them
// beside this text, so the guide never has to say what state the system is in today.
//
// THE CODE IS THE SOURCE. This was written on 2026-10-21 from the screens as they stood at
// 884fc3a. House of Hud's copy of this assistant answered 18 of 40 questions wrong after its guide
// went seven weeks without an edit while the screens changed under it, so test/helpGuide.ts fails
// when a **bold** phrase here is no longer a label the TV, Settings, the Jobs Board or the Gmail
// labels show, when a rail item goes unmentioned, or when a retired name comes back. Bold is for
// labels only: a word bolded for emphasis fails that test.

export const HELP_GREETING =
  "Hi, I'm the **Spartan Crew** help assistant. Ask me what a card on the **Live Feed** means, what the Gmail labels say, what the bot does in OnSinch, or what a setting in **Settings** does.";

export const HELP_KNOWLEDGE = `# Spartan Crew: how the tool works

## 1 · What it is for
The tool reads every email that reaches the bookings inbox and works out what the client wants: a new booking, a change to a booking (times, crew, days, a cancellation), or an answer. It finds the client's order in OnSinch, makes the change itself when it safely can, and puts everything a person still has to do on one board, the **Live Feed**, which the office TV shows full screen. A Gmail label on every thread says where it stands. Nothing is ever emailed to the team as a to-do list: the board is the one place to look.

## 2 · Signing in and getting around
- Sign in with **Continue with Google**, using your Spartan Crew work account.
- The menu (the rail) holds **Live Feed** (the board), **Jobs Board** (only when it is switched on in Settings) and **Settings**.
- The office TV shows the **Live Feed** on its own, without the menu.

## 3 · The Live Feed (the TV board)
One tile per job that needs a person. Each tile shows the client, a label, the job's R number and J number from OnSinch (R is the order, J is the job), and the day it starts: Today, Tomorrow or the date, with "+2 Days" when it runs longer. The line under the client says what is needed, for example "New booking 08:00-16:00, 4 crew", "Add 2 crew", "Times to 09:00-17:00", "Move Mon to Tue", "Cancel Fri 24 Oct" or "Quote request", or why the bot left it for a person.
- The labels: **Order Needs Created** (the client asked for crew and the order still has to be made) and **Order Needs Updated** (a change the client asked for still has to be made in OnSinch), in orange. When the work is done the same tile reads **Order Created** or **Order Updated** in green. **Needs Reply** means the client asked something that needs an email answer.
- The list shows only jobs whose order is in OnSinch with an R and a J number. Enquiries with no order yet are counted at the foot of the list instead ("enquiries have no order in OnSinch yet, not listed: see the Gmail labels") and keep their Gmail label. Settings, **Enquiries with no order on the TV board**, lists them again.
- **Confirm** is the button to press once you have dealt with a job: the tile turns green, waits a moment, then moves to **Done**, and **Undo** appears for a few seconds in case it was the wrong one. A tile that turned green on its own (the bot made the change, or staff did it in OnSinch) shows **Done** and needs nothing. Its line then says what happened: changed in OnSinch by staff, order found in OnSinch, or **Cleared by the system**.
- Jobs with nothing new for a week sink under a heading, "Nothing New For 7+ Days"; finished jobs are under **Done**. At the bottom, "more waiting below" counts tiles under the fold. The TV glides back to the top 20 seconds after anyone scrolls, and chimes when something new arrives (once somebody has clicked the screen to allow sound).
- The figures at the top count the list: **Needs Follow Up** (open jobs with nothing from anyone for 24 hours), **Within 48 Hours** (open jobs starting within two days, shown larger because time is running out), and **Needs Reply** when AI email drafts are switched on.
- The sync sign beside them: **Synced** (green: Gmail and OnSinch are coming through), **Sync Error** (red: the board could not be read, no email has arrived for 90 minutes in working hours, or OnSinch could not be read), **Intake Paused** (grey: email intake is switched off on purpose, and jobs still sync with OnSinch), or **Offline** (grey: this screen cannot reach the system). **Fullscreen** fills the screen; the button and the cursor hide after a few idle seconds.
- When the list is empty it says "Everything is checked." or "Nothing else waiting.", or warns that the sync is not healthy.
- **Analytics**, a tab above the list, opens the numbers, when it is switched on in Settings.

## 4 · The Gmail labels
Every thread carries exactly one of four labels, set from the board every minute; nobody sets them by hand: **Order Created**, **Order Updated**, **Order Needs Created**, **Order Needs Updated**. A thread can also carry **Needs Follow Up**, which is about the conversation, not the order. An enquiry with no order in OnSinch keeps its label even though the board does not list it.

## 5 · What the bot does in OnSinch
When the bot is allowed to write (the live state below says whether it is now):
- It finds the client's order by evidence, strongest first: an R or J number anywhere in the thread, the PO or project reference in the order's name, then the day together with one more fact (the venue, the start time, the crew count). Never by the day alone.
- A new booking: it creates the order only when the first day is more than the set number of days after the email (Settings, **Only create orders this far ahead**; 14 by default). Nearer bookings are staff's to create. Every order it creates carries a line in its description, "CHECK price list: card ..., from ...", because OnSinch does not tell it the client's default price list.
- A change: it adds shifts, changes crew numbers and times, moves days and cancels shifts on the client's order.
- It leaves a card for a person instead when crew have already signed on to the shift, when the day is already over, or when it cannot tell which order or what change is meant.
- It never books something again from the history quoted in an email, and when staff built or changed a shift after the client's email, staff's version stands.
- Every minute it checks each open card against OnSinch as it is now, so a job staff have since booked or changed by hand clears itself.

## 6 · The Jobs Board
The older board, off unless Settings, **Jobs Board in the menu**, is on. It lists the jobs the engine has handled, with **Search jobs** and **Filter by lane**. Each job says whether it is a **New job** or an **Update**, the **OnSinch order number** and **OnSinch job number**, **What the engine decided**, and its **Details**.

## 7 · Settings
Changes here apply to the whole team.
- **Bot orders and updates**: the master switch for the bot creating and updating orders in OnSinch; off by default. Off, every email is still read and decided, and anything the bot would have written appears on the board as a card to do by hand. (A second switch on the server must also be on before the bot writes.)
- **AI email drafts**: one switch for every email the system writes into a Gmail thread, replies and chases alike; off by default. **Reply delivery**: **Draft** (left in Gmail for a person to send; the default) or **Send**. **Which emails get a reply**: **All emails** or **New enquiries only**.
- **Screens**: **Jobs Board in the menu**, **Analytics tab on the TV board**, **Enquiries with no order on the TV board** (off by default).
- **Email intake paused**: the system has been switched off on purpose; the board shows **Intake Paused** instead of an error.
- **New orders**: **Only create orders this far ahead**, with **Days ahead**.
- **Test data**: **Clear test data automatically** removes the practice orders made on the test company.
- **Install app** puts the board on a phone or computer like an app. **Trigger** is the technical link from the mailbox to the tool. **Account** shows who is signed in, with **Sign out**.

## 8 · Getting help
- This assistant (the round button at the edge of the screen; drag it anywhere) answers questions about the tool. It cannot see clients, orders or emails, and it cannot do anything for you: it tells you where to look and what to press.
- **Report an issue**: press the flag in this panel, describe the problem, and press **File report**. It goes to SamurAI Solutions with this conversation attached. Leave client names, numbers and addresses out of the text.`;

// Starter chips shown in the empty widget: the questions the board raises.
export const HELP_SUGGESTIONS = [
  "What does Order Needs Updated mean?",
  "Why is a job missing from the TV?",
  "What does Confirm do?",
  "Why does the sync say Intake Paused?",
  "What does the bot do in OnSinch?",
  "What do the Gmail labels mean?",
];
