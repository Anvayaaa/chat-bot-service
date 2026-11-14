import { env } from "../config/env.js";

// Every call goes to the CRM's own API with the person's chat pass, so the CRM
// applies its usual rules: their company only, their role, their leads.
export class CrmError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 10_000;

const request = async (method, path, { params, body } = {}, auth) => {
  const url = new URL(env.crmApiUrl + path);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CrmError(503, error.name === "TimeoutError" ? "The CRM took too long to answer." : "The CRM could not be reached.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.message || (typeof data.errors === "string" ? data.errors : null) || "CRM request failed.";
    throw new CrmError(response.status, message);
  }

  return data;
};

export const crmGet = (path, params, auth) => request("GET", path, { params }, auth);

export const crmPost = (path, body, auth) => request("POST", path, { body }, auth);
