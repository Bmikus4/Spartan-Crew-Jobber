# 02 Review

Every failure (7), then two passing cases per template (60). Tick one box per case; a verdict here overrides the scorer.

## Failures

### S0210 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800840,\"po\":\"37463\"}"]; got none: no change asked for; PO "37463" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "37463" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40840
From: Nina Okafor <nina@tidewatermedia.co.uk>
Sent: 2026-10-17T17:00:00.000Z

Hi,

The PO for R40840 is 37463.

Thanks,
Nina

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0211 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800844,\"po\":\"93698\"}"]; got none: no change asked for; PO "93698" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "93698" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40844
From: Ollie King <ollie@vantagescenic.com>
Sent: 2026-10-17T07:37:00.000Z

Hi,

The PO for R40844 is 93698.

Thanks,
Ollie

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0213 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800852,\"po\":\"32616\"}"]; got none: no change asked for; PO "32616" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "32616" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40852
From: Hannah Bell <hannah@meridianlive.com>
Sent: 2026-10-17T08:51:00.000Z

Hello,

The PO for R40852 is 32616.

Many thanks
Hannah Bell
Meridian Live
```

[ ] correct  [ ] incorrect

notes:

### S0222 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800888,\"po\":\"84736\"}"]; got none: no change asked for; PO "84736" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "84736" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40888
From: Sam Carter <sam@northlightav.co.uk>
Sent: 2026-10-17T14:24:00.000Z

Hello,

The PO for R40888 is 84736.

Cheers,
Sam

Sent from my iPhone

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0223 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800892,\"po\":\"60447\"}"]; got none: no change asked for; PO "60447" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "60447" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40892
From: Fay Mills <fay@vantagescenic.com>
Sent: 2026-10-17T15:01:00.000Z

Hello,

The PO for R40892 is 60447.

Many thanks
Fay Mills
Vantage Scenic

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0224 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** e2e (expected write ["{\"kind\":\"set_po\",\"order_id\":800896,\"po\":\"18722\"}"]; got none: no change asked for; PO "18722" left off: not a single reference after a PO label)
- **Expected:** write ["set_po"]; intent info_only
- **System:** none: no change asked for; PO "18722" left off: not a single reference after a PO label; intent info_only

```text
Subject: PO - R40896
From: Jo Patel <jo@brightwaterproductions.com>
Sent: 2026-10-17T15:38:00.000Z

Hi Dan,

The PO for R40896 is 18722.

Kind regards,
Jo Patel
Production Manager | Brightwater Productions
M: 07700 963458
```

[ ] correct  [ ] incorrect

notes:

### S0354 · P2 two R numbers
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** ai.intent (intent unclear, expected change)
- **Expected:** handoff; intent change
- **System:** person: request 1: not an operation the system performs; intent unclear

```text
Subject: R41416 / R41417
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-20T15:48:00.000Z

Hi Dan,

For R41416 and R41417, could the shift on 23/10 be from 10AM to 4PM?

Thanks,
Ella

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

## Passing sample

### S0000 · P26 new booking
- **Rules:** P1.R3, P1.R8, P1.R9, P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 1 shift(s) at Tobacco Dock; intent booking

```text
Subject: Crew request - Tobacco Dock
From: Ben Ashby <ben@copperfieldexpo.co.uk>
Sent: 2026-10-12T07:30:00.000Z

Hi team,

We need 5 x Crew at Tobacco Dock on 16/10, 13:00 - 1800.

Kind regards,
Ben Ashby
Production Manager | Copperfield Exhibitions
M: 07700 930048
```

[ ] correct  [ ] incorrect

notes:

### S0001 · P26 new booking
- **Rules:** P1.R3, P1.R8, P1.R9, P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 1 shift(s) at The Brewery; intent booking

```text
Subject: Crew needed
From: Dan Price <dan@halcyonstaging.co.uk>
Sent: 2026-10-12T08:07:00.000Z

Hi Dan,

Could we please book 4 x Crew for October 30th, 9:30 AM - 5.30pm at The Brewery?

Cheers,
Dan

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0065 · P26 new booking with a PO
- **Rules:** P1.R3, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 1 shift(s) at Roundhouse; intent booking

```text
Subject: Booking for Roundhouse
From: Dan Price <dan@halcyonstaging.co.uk>
Sent: 2026-10-13T07:35:00.000Z

Morning all,

Could we please book 8 x crew for Mon 19 Oct, 6.30am-12:30 PM at Roundhouse?

PO number: 18816

Thanks,
Dan
```

[ ] correct  [ ] incorrect

notes:

### S0066 · P26 new booking with a PO
- **Rules:** P1.R3, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 1 shift(s) at Old Billingsgate; intent booking

```text
Subject: Crew request - Old Billingsgate
From: Amy Ford <amy@halcyonstaging.co.uk>
Sent: 2026-10-13T08:12:00.000Z

Hi Dan,

Could we please book 4 crew members for 21st Oct, 1200 to 2200 at Old Billingsgate?

PO: 35471

Many thanks
Amy Ford
Halcyon Staging
```

[ ] correct  [ ] incorrect

notes:

### S0080 · X10 two shifts in one email
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 2 shift(s) at ExCeL London; intent booking

```text
Subject: Crew - ExCeL London
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-14T16:50:00.000Z

Good afternoon,

Could we book the following at ExCeL London please:

Wednesday 28th October: 1400 to 0000, 2 crew members
29th Oct: 06:30-12.30pm, 2 x Crew

Cheers,
Ella

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0081 · X10 two shifts in one email
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["create_order"]; intent booking
- **System:** write: new order: 2 shift(s) at Printworks; intent booking

```text
Subject: Crew - Printworks
From: Sam Carter <sam@northlightav.co.uk>
Sent: 2026-10-14T17:27:00.000Z

Hi team,

Could we book the following at Printworks please:

Sun 25 Oct: 1PM-1700, x3 crew
Monday the 26th: 12pm to 10pm, x3 crew

Many thanks
Sam Carter
Northlight AV
```

[ ] correct  [ ] incorrect

notes:

### S0095 · P10 time change by R number
- **Rules:** P1.R14, P1.R9 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40380 shift 8003800: times to 10:00-15:00; PO "R40380" left off: not a single reference after a PO label; intent change

```text
Subject: Re: R40380
From: Ollie King <ollie@vantagescenic.com>
Sent: 2026-10-14T16:05:00.000Z

Hello,

Change of plan for 2nd Nov (R40380): can the crew do 10am-1500 instead?

Many thanks
Ollie King
Vantage Scenic

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0096 · P10 time change by R number
- **Rules:** P1.R14, P1.R9 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40384 shift 8003840: times to 08:00-13:00; PO "R40384" left off: not a single reference after a PO label; intent change

```text
Subject: Re: R40384
From: Jo Patel <jo@brightwaterproductions.com>
Sent: 2026-10-14T16:42:00.000Z

Hi Dan,

Could we change the times for Friday the 30th (R40384) to 0800 to 1300 please?

Kind regards,
Jo Patel
Production Manager | Brightwater Productions
M: 07700 965649
```

[ ] correct  [ ] incorrect

notes:

### S0120 · P6 time change by day
- **Rules:** P1.R14, P1.R9 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40480 shift 8004800: times to 10:00-18:00; intent change

```text
Subject: Change of times
From: Hannah Bell <hannah@meridianlive.com>
Sent: 2026-10-15T11:30:00.000Z

Hello,

Change of plan for Sunday the 1st: can the crew do 1000 to 6PM instead?

Many thanks
Hannah Bell
Meridian Live
```

[ ] correct  [ ] incorrect

notes:

### S0121 · P6 time change by day
- **Rules:** P1.R14, P1.R9 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40484 shift 8004840: times to 08:00-18:00; intent change

```text
Subject: Change of times
From: Zoe Hart <zoe@lumentheatre.org.uk>
Sent: 2026-10-15T12:07:00.000Z

Morning all,

Could we change the times for Sunday 18th October to 8AM till 6pm please?

Cheers,
Zoe

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0140 · G5 time change by weekday alone
- **Rules:** P1.R8, P1.R14 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times"]; intent change
- **System:** write: R40560 shift 8005600: times to 07:00-12:00; intent change

```text
Subject: Quick change
From: Dan Price <dan@halcyonstaging.co.uk>
Sent: 2026-10-15T13:50:00.000Z

Hi Dan,

Can Monday's shift be 07:00-12PM instead?

Thanks,
Dan

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0141 · G5 time change by weekday alone
- **Rules:** P1.R8, P1.R14 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40564 shift 8005640: times to 10:00-14:00; intent change

```text
Subject: Quick change
From: Will Banks <will@lumentheatre.org.uk>
Sent: 2026-10-15T14:27:00.000Z

Hello,

Can Monday's shift be from 1000 to 2pm instead?

Cheers,
Will

Sent from my iPhone

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0150 · P11 longer shift by hours
- **Rules:** P1.R14 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40600 shift 8006000: times to 09:00-19:00; intent change

```text
Subject: Extending a shift
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-15T10:00:00.000Z

Hello,

Could we extend the shift on October 26th to 10hrs please? Currently it is 4 hours.

Many thanks
Marcus Lee
Brightwater Productions

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0151 · P11 longer shift by hours
- **Rules:** P1.R14 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_times","set_position_times"]; intent change
- **System:** write: R40604 shift 8006040: times to 10:00-20:00; intent change

```text
Subject: Extending a shift
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-15T10:37:00.000Z

Hello,

Could we extend the shift on 29th Oct to 10hrs please? Currently it is 4 hours.

Cheers,
Ella

Sent from my iPhone

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0165 · P13 crew total
- **Rules:** P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_size"]; intent change
- **System:** write: R40660 shift 8006600: 6 crew in all; intent change

```text
Subject: More crew
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-16T09:15:00.000Z

Hello,

Can we make it 6 x crew on Tuesday the 3rd please?

Cheers,
Marcus

Sent from my iPhone

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0166 · P13 crew total
- **Rules:** P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_size"]; intent change
- **System:** write: R40664 shift 8006640: 9 crew in all; intent change

```text
Subject: More crew
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-16T09:52:00.000Z

Hi Dan,

Can we make it 9 crew on October 28th please?

Cheers,
Ella

Sent from my iPhone

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0180 · P14 crew increase
- **Rules:** P1.R17 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_size"]; intent change
- **System:** write: R40720 shift 8007200: 7 crew in all; intent change

```text
Subject: More crew
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-16T08:30:00.000Z

Hi team,

Please can we add 3 extra crew on 01/11?

Many thanks
Marcus Lee
Brightwater Productions

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0181 · P14 crew increase
- **Rules:** P1.R17 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_position_size"]; intent change
- **System:** write: R40724 shift 8007240: 7 crew in all; intent change

```text
Subject: More crew
From: Zoe Hart <zoe@lumentheatre.org.uk>
Sent: 2026-10-16T09:07:00.000Z

Morning all,

Could you add 1 extra crew to Thursday 5th November?

Cheers,
Zoe

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0195 · P19 cancel a shift
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["cancel_position","cancel_position"]; intent cancellation or change
- **System:** write: R40780 shift 8007801: cancelled; intent cancellation

```text
Subject: Cancellation
From: Ben Ashby <ben@copperfieldexpo.co.uk>
Sent: 2026-10-16T07:45:00.000Z

Morning all,

Unfortunately we need to cancel the shift on Friday the 30th. The other day is still going ahead.

Kind regards,
Ben Ashby
Production Manager | Copperfield Exhibitions
M: 07700 975422

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0196 · P19 cancel a shift
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["cancel_position","cancel_position"]; intent cancellation or change
- **System:** write: R40784 shift 8007840: cancelled; intent cancellation

```text
Subject: Cancellation
From: Lucy Grant <lucy@copperfieldexpo.co.uk>
Sent: 2026-10-16T08:22:00.000Z

Hi Dan,

Unfortunately we need to cancel the shift on 24/10. The other day is still going ahead.

Many thanks
Lucy Grant
Copperfield Exhibitions

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0212 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_po"]; intent info_only
- **System:** write: R40848: PO 23945; intent info_only

```text
Subject: PO - R40848
From: Rob Dale <rob@tidewatermedia.co.uk>
Sent: 2026-10-17T08:14:00.000Z

Good afternoon,

PO number: 23945 (for R40848)

Many thanks
Rob Dale
Tidewater Media
```

[ ] correct  [ ] incorrect

notes:

### S0214 · P28 PO for a named order
- **Rules:** P1.R11, P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["set_po"]; intent info_only
- **System:** write: R40856: PO 51124; intent info_only

```text
Subject: PO - R40856
From: Will Banks <will@lumentheatre.org.uk>
Sent: 2026-10-17T09:28:00.000Z

Good afternoon,

PO number: 51124 (for R40856)

Many thanks
Will Banks
Lumen Theatre Company

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0225 · P20 add a shift to a named order
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["add_shift"]; intent booking or change
- **System:** write: R40900: add a shift on 2026-11-07 22:00-02:00, 3 crew; PO "R40900" left off: not a single reference after a PO label; intent booking

```text
Subject: Re: R40900
From: Rob Dale <rob@tidewatermedia.co.uk>
Sent: 2026-10-17T16:15:00.000Z

Hi Dan,

Please can you add a derig to R40900 on Sat 7 Nov, 10PM to 2am, 3 x Crew.

Kind regards,
Rob Dale
Production Manager | Tidewater Media
M: 07700 953023

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0226 · P20 add a shift to a named order
- **Rules:** P1.R13 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** write ["add_shift"]; intent booking or change
- **System:** write: R40904: add a shift on 2026-11-04 22:00-02:00, 4 crew; PO "R40904" left off: not a single reference after a PO label; intent booking

```text
Subject: Re: R40904
From: Jo Patel <jo@brightwaterproductions.com>
Sent: 2026-10-17T16:52:00.000Z

Hi team,

Please can you add a derig to R40904 on November 4th, 2200 till 2am, 4 crew members.

Kind regards,
Jo Patel
Production Manager | Brightwater Productions
M: 07700 925329

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0235 · X3 quote request
- **Rules:** P1.R10 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent quote_request
- **System:** person: the client asked for a quote; intent quote_request

```text
Subject: Quote request
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-17T12:25:00.000Z

Hello,

Could you send me a quote for 8 x Crew on 1st Nov at Printworks. Times are from 0900 to 5PM.

Cheers,
Ella

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0236 · X3 quote request
- **Rules:** P1.R10 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent quote_request
- **System:** person: the client asked for a quote; intent quote_request

```text
Subject: Quote request
From: Dan Price <dan@halcyonstaging.co.uk>
Sent: 2026-10-17T13:02:00.000Z

Morning all,

Could you send me a quote for x3 crew on Friday 6th November at Tobacco Dock. Times are 08:00-12pm.

Many thanks
Dan Price
Halcyon Staging
```

[ ] correct  [ ] incorrect

notes:

### S0260 · G4 vague crew change
- **Rules:** P1.R6 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change or unclear
- **System:** person: request 1: no start time the client wrote; request 1: no end time or duration the client wrote; request 1: no crew count the client wrote; intent unclear

```text
Subject: Crew numbers
From: Zoe Hart <zoe@lumentheatre.org.uk>
Sent: 2026-10-18T07:50:00.000Z

Hi team,

Can we get the usual numbers for 30th Oct?

Thanks,
Zoe

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0261 · G4 vague crew change
- **Rules:** P1.R6 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change or unclear
- **System:** person: request 1: no crew count the client wrote; intent change

```text
Subject: Crew numbers
From: Zoe Hart <zoe@lumentheatre.org.uk>
Sent: 2026-10-18T08:27:00.000Z

Morning all,

Can we bump it up a couple for Monday 26th October?

Cheers,
Zoe

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0275 · P24 new booking, no venue
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no venue in the email; intent booking

```text
Subject: Crew booking
From: Fay Mills <fay@vantagescenic.com>
Sent: 2026-10-18T17:05:00.000Z

Good afternoon,

Please can I request 6 x crew on October 29th. Times are from 9am to 1900.

Thanks,
Fay
```

[ ] correct  [ ] incorrect

notes:

### S0276 · P24 new booking, no venue
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no venue in the email; intent booking

```text
Subject: Crew booking
From: Fay Mills <fay@vantagescenic.com>
Sent: 2026-10-18T07:42:00.000Z

Hi Dan,

We need 3 x crew on 29th Oct, 9am-1700.

Kind regards,
Fay Mills
Production Manager | Vantage Scenic
M: 07700 965858
```

[ ] correct  [ ] incorrect

notes:

### S0285 · P25 new booking, unknown venue
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: 0 OnSinch venues are named "Harbour Hall"; intent booking

```text
Subject: Crew booking
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-19T13:15:00.000Z

Hi,

Please can I request x6 crew on November 5th at Harbour Hall. Times are 10AM till 8pm.

Thanks,
Marcus
```

[ ] correct  [ ] incorrect

notes:

### S0286 · P25 new booking, unknown venue
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: 0 OnSinch venues are named "The Grand Room, Bermondsey"; intent booking

```text
Subject: Crew booking
From: Sam Carter <sam@northlightav.co.uk>
Sent: 2026-10-19T13:52:00.000Z

Morning all,

Please can I request x5 crew on Tuesday 3rd November at The Grand Room, Bermondsey. Times are 0700 - 1100.

Kind regards,
Sam Carter
Production Manager | Northlight AV
M: 07700 965223
```

[ ] correct  [ ] incorrect

notes:

### S0295 · G11 new booking, no end time
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: request 1: no end time or duration the client wrote; intent booking

```text
Subject: Booking for Alexandra Palace
From: Jo Patel <jo@brightwaterproductions.com>
Sent: 2026-10-19T09:25:00.000Z

Good afternoon,

We need 3 crew members at Alexandra Palace on Tue 27 Oct, 10:00 onwards.

Thanks,
Jo
```

[ ] correct  [ ] incorrect

notes:

### S0296 · G11 new booking, no end time
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: request 1: no end time or duration the client wrote; intent booking

```text
Subject: Crew request - Alexandra Palace
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-19T10:02:00.000Z

Hi Dan,

We need 3 crew at Alexandra Palace on Sun 25 Oct, 12:00 onwards.

Thanks,
Ella
```

[ ] correct  [ ] incorrect

notes:

### S0305 · P17 new booking, 13 crew
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: 13 crew is not a shape the system builds; intent booking

```text
Subject: Booking for Roundhouse
From: Ben Ashby <ben@copperfieldexpo.co.uk>
Sent: 2026-10-19T15:35:00.000Z

Good afternoon,

Please can I request 13 x Crew on 05/11 at Roundhouse. Times are 6:30 AM till 1430.

Thanks,
Ben
```

[ ] correct  [ ] incorrect

notes:

### S0306 · P17 new booking, 13 crew
- **Rules:** P1.R5 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: 13 crew is not a shape the system builds; intent booking

```text
Subject: Crew needed
From: Tom Hughes <tom@kestrelevents.co.uk>
Sent: 2026-10-19T16:12:00.000Z

Hi Dan,

We need x13 crew at Alexandra Palace on Friday the 30th, 1400-10pm.

Cheers,
Tom

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0310 · P16 crew change crossing the crew-chief line
- **Rules:** P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: request 1 crew: "increase to 5 crew" reads as null, not 5; request 1: no crew count the client wrote; intent change

```text
Subject: Crew numbers
From: Hannah Bell <hannah@meridianlive.com>
Sent: 2026-10-19T08:40:00.000Z

Hi team,

Can we increase to 5 crew on 25/10?

Thanks,
Hannah

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0311 · P16 crew change crossing the crew-chief line
- **Rules:** P1.R16 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: request 1 crew: "increase to 5 crew" reads as null, not 5; request 1: no crew count the client wrote; intent change

```text
Subject: Crew numbers
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-19T09:17:00.000Z

Morning all,

Can we increase to 5 crew on Mon 2 Nov?

Many thanks
Ella Reid
Kestrel Events
```

[ ] correct  [ ] incorrect

notes:

### S0320 · P1 booking from a personal address
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no single client company for zoe.hart@gmail.com; intent booking

```text
Subject: Crew booking
From: Zoe Hart <zoe.hart@gmail.com>
Sent: 2026-10-20T14:50:00.000Z

Hi,

We need x4 crew at Printworks on Sun 1 Nov, 09:30 to 1430.

Cheers,
Zoe

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0321 · P1 booking from a personal address
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no single client company for hannah.bell@gmail.com; intent booking

```text
Subject: Crew needed
From: Hannah Bell <hannah.bell@gmail.com>
Sent: 2026-10-20T15:27:00.000Z

Good afternoon,

Please can I request 5 x crew on 03/11 at Printworks. Times are 8AM to 6PM.

Thanks,
Hannah
```

[ ] correct  [ ] incorrect

notes:

### S0330 · P1 booking from a shared domain
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no single client company for rachel@atlasgroup.co.uk; intent booking

```text
Subject: Booking for Olympia London
From: Rachel Cole <rachel@atlasgroup.co.uk>
Sent: 2026-10-20T11:00:00.000Z

Hi,

Please can I request 5 x crew on Saturday 24th October at Olympia London. Times are 10pm-2am.

Kind regards,
Sam Carter
Production Manager | Northlight AV
M: 07700 960900
```

[ ] correct  [ ] incorrect

notes:

### S0331 · P1 booking from a shared domain
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent booking
- **System:** person: no single client company for rachel@atlasgroup.co.uk; intent booking

```text
Subject: Crew booking
From: Rachel Cole <rachel@atlasgroup.co.uk>
Sent: 2026-10-20T11:37:00.000Z

Hello,

We need 3 x crew at ExCeL London on Thursday 29th October, 09:00 - 1400.

Kind regards,
Marcus Lee
Production Manager | Brightwater Productions
M: 07700 965805
```

[ ] correct  [ ] incorrect

notes:

### S0335 · P3 another client's R number
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: R41341 belongs to another client; intent change

```text
Subject: Re: R41341
From: Nina Okafor <nina@tidewatermedia.co.uk>
Sent: 2026-10-20T14:05:00.000Z

Good afternoon,

Could we change the times for 31st Oct (R41341) to 12PM - 4PM please?

Kind regards,
Nina Okafor
Production Manager | Tidewater Media
M: 07700 979676
```

[ ] correct  [ ] incorrect

notes:

### S0336 · P3 another client's R number
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: R41345 belongs to another client; intent change

```text
Subject: Re: R41345
From: Jo Patel <jo@brightwaterproductions.com>
Sent: 2026-10-20T14:42:00.000Z

Morning all,

Could we change the times for 08/11 (R41345) to 0800-1600 please?

Thanks,
Jo
```

[ ] correct  [ ] incorrect

notes:

### S0350 · P2 two R numbers
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: the email names 2 orders; intent change

```text
Subject: R41400 / R41401
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-20T13:20:00.000Z

Hi Dan,

For R41400 and R41401, could the shift on Thu 5 Nov be 2pm to 22:00?

Kind regards,
Marcus Lee
Production Manager | Brightwater Productions
M: 07700 940495

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0351 · P2 two R numbers
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: the email names 2 orders; intent change

```text
Subject: R41404 / R41405
From: Ollie King <ollie@vantagescenic.com>
Sent: 2026-10-20T13:57:00.000Z

Hi Dan,

For R41404 and R41405, could the shift on Sunday the 8th be 9:30 AM till 14:30?

Cheers,
Ollie

Sent from my iPhone

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0355 · P8 two orders that day, no venue
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: 2 of the client's orders have a shift on 2026-10-30; intent change

```text
Subject: Times
From: Ian Short <ian@orchardhire.co.uk>
Sent: 2026-10-20T16:25:00.000Z

Hi Dan,

Could we change the times for Friday 30th October to 0900 till 1300 please?

Many thanks
Ian Short
Orchard Hire

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0356 · P8 two orders that day, no venue
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: 2 of the client's orders have a shift on 2026-10-31; intent change

```text
Subject: Times
From: Hannah Bell <hannah@meridianlive.com>
Sent: 2026-10-20T17:02:00.000Z

Good afternoon,

Could we change the times for Sat 31 Oct to from 6:30 AM to 4.30pm please?

Thanks,
Hannah

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0365 · P9 change on a day with no booking
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: no booking for this client on 2026-11-07; intent change

```text
Subject: Times
From: Fay Mills <fay@vantagescenic.com>
Sent: 2026-10-21T12:35:00.000Z

Morning all,

Could we change the times for 07/11 to 07:00 till 11AM please?

Cheers,
Fay

Sent from my iPhone

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0366 · P9 change on a day with no booking
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent change
- **System:** person: no booking for this client on 2026-10-30; intent change

```text
Subject: Times
From: Chris Wood <chris@meridianlive.com>
Sent: 2026-10-21T13:12:00.000Z

Hi,

Could we change the times for October 30th to 09:00 to 2pm please?

Thanks,
Chris

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0375 · P29 PO with no order named
- **Rules:** P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent info_only
- **System:** person: PO 63158: no order is named; intent info_only

```text
Subject: PO
From: Chris Wood <chris@meridianlive.com>
Sent: 2026-10-21T08:45:00.000Z

Hi team,

Our PO number is 63158, please add it to our booking.

Many thanks
Chris Wood
Meridian Live

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0376 · P29 PO with no order named
- **Rules:** P1.R12 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** handoff; intent info_only
- **System:** person: PO 87405: no order is named; intent info_only

```text
Subject: PO
From: Sam Carter <sam@northlightav.co.uk>
Sent: 2026-10-21T09:22:00.000Z

Good afternoon,

Our PO: 87405, please add it to our booking.

Kind regards,
Sam Carter
Production Manager | Northlight AV
M: 07700 991557

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0385 · X1 thanks
- **Rules:** P1.R11 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Re: Crew booking
From: Hannah Bell <hannah@meridianlive.com>
Sent: 2026-10-21T14:55:00.000Z

Good afternoon,

Great, thank you!

Kind regards,
Hannah Bell
Production Manager | Meridian Live
M: 07700 945611

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0386 · X1 thanks
- **Rules:** P1.R11 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Re: Crew booking
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-21T15:32:00.000Z

Good afternoon,

Thanks Dan, much appreciated.

Kind regards,
Marcus Lee
Production Manager | Brightwater Productions
M: 07700 947219

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0435 · X11 booking only in the quoted history
- **Rules:** P1.R4 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Re: Crew booking
From: Marcus Lee <marcus@brightwaterproductions.com>
Sent: 2026-10-22T15:45:00.000Z

Hello,

Lovely, thanks Dan.

Many thanks
Marcus Lee
Brightwater Productions

On Tue, 6 Oct 2026 at 09:14, Marcus Lee <marcus@brightwaterproductions.com> wrote:
> Morning all,
> 
> We need 2 crew members at Alexandra Palace on Tue 10 Nov, from 08:00 to 14:00.
> 
> Thanks,
> Tom
```

[ ] correct  [ ] incorrect

notes:

### S0436 · X11 booking only in the quoted history
- **Rules:** P1.R4 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Re: Crew booking
From: Ella Reid <ella@kestrelevents.co.uk>
Sent: 2026-10-22T16:22:00.000Z

Morning all,

Thanks, that works for us.

Thanks,
Ella

On Tue, 6 Oct 2026 at 09:14, Ella Reid <ella@kestrelevents.co.uk> wrote:
> Good afternoon,
> 
> Could we please book 6 x Crew for 28th Oct, 10:00 - 6pm at ExCeL London?
> 
> Thanks,
> Ian
```

[ ] correct  [ ] incorrect

notes:

### S0455 · X1 contacts and meeting point
- **Rules:** P1.R11 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Info for the crew
From: Ollie King <ollie@vantagescenic.com>
Sent: 2026-10-23T08:05:00.000Z

Hi,

Please can the crew bring their own PPE (steel toe caps and hi-vis).

Thanks,
Ollie

On Mon, 5 Oct 2026 at 10:02, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:
> Hi, thanks for your email, we will get this booked in.
> Thanks, Dan
```

[ ] correct  [ ] incorrect

notes:

### S0456 · X1 contacts and meeting point
- **Rules:** P1.R11 · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent info_only
- **System:** none: no change asked for; intent info_only

```text
Subject: Info for the crew
From: Kate Moss <kate@orchardhire.co.uk>
Sent: 2026-10-23T08:42:00.000Z

Hi Dan,

The meeting point is the loading bay at The Brewery. Contact on the day is Kate Moss on 07700 900515.

Kind regards,
Kate Moss
Production Manager | Orchard Hire
M: 07700 921519

-----Original Message-----
From: Bookings <bookings@spartancrew.co.uk>
Sent: 02 October 2026 14:11
Subject: RE: Crew

Thanks, all noted on our side.
```

[ ] correct  [ ] incorrect

notes:

### S0480 · P22 already booked
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent booking
- **System:** none: already booked: R41920; intent booking

```text
Subject: Booking for Printworks
From: Ben Ashby <ben@copperfieldexpo.co.uk>
Sent: 2026-10-24T13:30:00.000Z

Morning all,

Could we please book 8 x crew for Sun 8 Nov, 10PM - 02:00 at Printworks?

Cheers,
Ben

Sent from my iPhone
```

[ ] correct  [ ] incorrect

notes:

### S0481 · P22 already booked
- **Rules:** none · **Source:** synthetic-by-construction
- **Failed observations:** none
- **Expected:** none; intent booking
- **System:** none: already booked: R41924; intent booking

```text
Subject: Crew request - Tobacco Dock
From: Ian Short <ian@orchardhire.co.uk>
Sent: 2026-10-24T14:07:00.000Z

Hello,

Please can I request 3 crew members on 30th Oct at Tobacco Dock. Times are 1400-22:00.

Many thanks
Ian Short
Orchard Hire
```

[ ] correct  [ ] incorrect

notes:
