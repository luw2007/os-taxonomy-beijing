export function withAgreement(agreed, requestAgreement, action) {
  if (!agreed) {
    requestAgreement();
    return false;
  }
  action();
  return true;
}
