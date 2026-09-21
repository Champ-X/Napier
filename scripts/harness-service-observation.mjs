/** Service observation is an explicit campaign requirement, not an implicit
 * condition on unrelated library or file-processing tasks. */
export function serviceObservationPassed(required, receipts) {
  if (typeof required !== "boolean" || !Array.isArray(receipts))
    throw new Error("Invalid service observation requirement");
  return (
    !required ||
    (receipts.length > 0 &&
      receipts.every((receipt) => receipt?.passed === true))
  );
}
