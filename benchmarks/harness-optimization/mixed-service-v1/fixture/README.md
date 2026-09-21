# Booking preview

This small web application uses a browser TypeScript frontend, a Node development server, and a Python HTTP backend. The development server transpiles TypeScript in memory and proxies /api/quote to Python; no dependencies or generated files are needed. The application is a quote preview, so requests do not mutate capacity.

## Contract

- parseSeats(raw) accepts only a string whose trimmed content matches ASCII digits, starts with 1-9, and denotes an integer from 1 through 20. Whitespace surrounding a valid value is allowed. Leading zeroes, decimals, signs, exponents, trailing text and out-of-range values throw TypeError.
- quote(seats, capacity, used) requires Python integers, excluding booleans. seats is 1..20; capacity is 0..100; used is 0..capacity. Invalid inputs raise ValueError before computing any result.
- A booking is allowed if seats is less than or equal to capacity minus used. An allowed quote has remaining = capacity - used - seats and priceCents = seats * 1250. A denied quote leaves remaining = capacity - used and priceCents = 0.
- formatQuote returns exactly `Reserved N seats; $P.PP; R remaining` for an allowed quote, and `Unavailable; R remaining` otherwise. Price is dollars with exactly two decimals; zero remaining must be displayed as zero.

## Verification and service

- Frontend typecheck: TypeScript with frontend/tsconfig.json; no emit.
- Frontend tests: `node --test frontend/booking.test.mjs`.
- Python tests: `python3 -B -m unittest discover -s backend -p 'test_*.py'`.
- `node dev-server.mjs` starts the frontend on 8090 and Python API on 8091. GET /ready verifies backend readiness. GET / serves the real form; /app.js and /booking.js are compiled browser modules. POST /api/quote accepts JSON {seats, capacity, used}, returning the quote or HTTP 400 for invalid inputs. Both servers bind only inside the container. Stop the managed process after verification.
