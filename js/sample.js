/* Demo input: what a student would paste from syllabi, VTOP announcements and WhatsApp groups. */
window.CRUNCH_SAMPLE = {
  today: '2026-10-15',
  text: `BCSE302L - Database Systems
DA 1: ER diagram for library system due 20 Oct (10%)
DA 2: Normalisation + SQL queries, builds on DA 1, due 29 Oct (10%) ~6h
CAT 2 on 3 Nov (15%)

BCSE303L - Operating Systems
Lab experiment 5 (process scheduling) record by 18/10
Lab experiment 6 (deadlock detection) record by 25/10
Quiz 2 on Friday (5%)
OS mini project review 1 on 27 Oct (10%) 8h
OS mini project review 2 on 10 Nov (15%) 10h

BMAT205L - Discrete Mathematics
Assignment 3 (graph theory problem set) due Oct 22 (5%)
CAT 2 on 31 Oct (15%) 10 hours

BSTS301P - Soft Skills
Presentation on case study due 24 Oct (10%)

Club stuff - IEEE RAS
Workshop poster, no fixed date yet`,
  settings: {
    // Free study hours by weekday, Sun..Sat
    availability: [6, 3, 3, 2.5, 3, 2, 6],
    commitments: [
      { date: '2026-10-19', hours: 2, label: 'Club meeting' },
      { date: '2026-10-25', hours: 4, label: 'Family function' },
    ],
    // Same settings that were evaluated (eval/tuned.json)
    bufferDays: 2,
    sessionMax: 2,
    headroom: 2,
  },
};
