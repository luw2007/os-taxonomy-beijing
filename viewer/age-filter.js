export function ageRangeForAge(value) {
  const age = Number(value);
  return Number.isInteger(age) && age >= 4 && age <= 15 ? `${age}-${age}` : null;
}
