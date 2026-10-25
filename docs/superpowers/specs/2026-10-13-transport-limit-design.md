# Automatic transport limit

Approved scope: automatic launches stop at two active owned transports, including
manual ships in the count, leaving the third game slot for manual use. Existing
trips are not cancelled. No travel-time or landing-ranking change.

Enforce at the common intent gateway, identify the actual boat constructor in
bootstrap, and expose capacity as command eligibility and scalar trace facts.
Track successful submissions not yet observed as reservations shared by all
actors belonging to the bot. Newly observed active ship IDs with a matching
destination consume reservations. A read-only event listener counts pending
manual launches as well, including those sharing an automatic destination. The
bot's own synchronous emissions are excluded from that listener's manual count.
The listener is detached when a new bot replaces the old one. It never changes
or blocks manual events. EventBus on/off API verified against upstream source:
https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/EventBus.ts
False/throwing submissions release their reservation. Unconfirmed submissions
remain reserved conservatively until ships appear or a new bot is attached;
there is no timeout that could admit a third delayed launch. Manual inputs bypass
the bot gateway. Unit-state read failures block automatic boat launches explicitly.

Test full capacity, one manual ship, sequential pending launches across ticks,
observation reconciliation, arrivals freeing capacity, failures and policy holds.
