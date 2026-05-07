# Linear API Notes

Verified against Linear developer documentation on 2026-05-07.

- Endpoint: `https://api.linear.app/graphql`
- Authentication: personal API keys use `Authorization: <API_KEY>`; OAuth access tokens use `Authorization: Bearer <ACCESS_TOKEN>`.
- Issue creation mutation: `issueCreate(input: { title, description, teamId })`.
- `teamId` and `title` are the minimum required inputs for creating an issue.
- If `stateId` is omitted, Linear assigns the team's first Backlog workflow state, or Triage when that feature is enabled.

The plugin helper tries to find a team workflow state named `Backlog` and sets it explicitly. If no matching state exists, Linear's default assignment behavior applies.
