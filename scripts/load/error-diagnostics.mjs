export function safeErrorMessage(value) {
  return String(value || '').replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').replace(/([?&](?:token|key|secret|password)=)[^&\s]+/ig, '$1[redacted]').slice(0, 240);
}
export function errorDiagnostic(error) {
  const description = error?.description, nested = description?.error;
  return { name: error?.name, code: error?.code, message: safeErrorMessage(error?.message),
    causeCode: error?.cause?.code, causeMessage: safeErrorMessage(error?.cause?.message),
    descriptionName: typeof description === 'object' ? description?.name : undefined,
    descriptionMessage: safeErrorMessage(typeof description === 'string' ? description : description?.message),
    descriptionCode: description?.code, transportErrorCode: nested?.code, transportErrorMessage: safeErrorMessage(nested?.message),
    serverErrorCode: error?.data?.code, serverErrorMessage: safeErrorMessage(error?.data?.message),
  };
}
