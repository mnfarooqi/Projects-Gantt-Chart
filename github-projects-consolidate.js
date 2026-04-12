import fs from "node:fs";

const ORG = "MQSS-management";
const API = "https://api.github.com/graphql";
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN env var");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function listOrgProjects(org) {
  const query = `
    query($org: String!, $after: String) {
      organization(login: $org) {
        projectsV2(first: 50, after: $after) {
          nodes { id number title closed url updatedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  let after = null;
  const out = [];
  while (true) {
    const data = await gql(query, { org, after });
    const page = data.organization.projectsV2;
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

async function listProjectItems(projectId) {
  const query = `
    query($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          id
          title
          items(first: 100, after: $after) {
            nodes {
              id
              createdAt
              updatedAt
              content {
                __typename
                ... on Issue {
                  id number title state url
                  repository { nameWithOwner }
                }
                ... on PullRequest {
                  id number title state url
                  repository { nameWithOwner }
                }
              }
              fieldValues(first: 50) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  let after = null;
  const items = [];
  while (true) {
    const data = await gql(query, { projectId, after });
    const proj = data.node;
    const page = proj.items;
    items.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return items;
}

function normalizeFieldValues(fieldValues) {
  const obj = {};
  for (const fv of fieldValues?.nodes ?? []) {
    const fieldName = fv?.field?.name;
    if (!fieldName) continue;

    // pick the value depending on the type
    if (fv.__typename === "ProjectV2ItemFieldTextValue") obj[fieldName] = fv.text;
    else if (fv.__typename === "ProjectV2ItemFieldNumberValue") obj[fieldName] = fv.number;
    else if (fv.__typename === "ProjectV2ItemFieldDateValue") obj[fieldName] = fv.date;
    else if (fv.__typename === "ProjectV2ItemFieldSingleSelectValue") obj[fieldName] = fv.name;
    else if (fv.__typename === "ProjectV2ItemFieldIterationValue") obj[fieldName] = fv.title;
  }
  return obj;
}

(async () => {
  const projects = await listOrgProjects(ORG);

  const consolidated = [];
  for (const p of projects) {
    const items = await listProjectItems(p.id);

    for (const it of items) {
      consolidated.push({
        org: ORG,
        project_number: p.number,
        project_title: p.title,
        project_url: p.url,
        project_closed: p.closed,

        item_id: it.id,
        item_createdAt: it.createdAt,
        item_updatedAt: it.updatedAt,

        content_type: it.content?.__typename ?? "DraftIssueOrRedacted",
        repo: it.content?.repository?.nameWithOwner ?? null,
        number: it.content?.number ?? null,
        title: it.content?.title ?? null,
        state: it.content?.state ?? null,
        url: it.content?.url ?? null,

        fields: normalizeFieldValues(it.fieldValues),
      });
    }
  }

  fs.writeFileSync("mqss_projects_items.json", JSON.stringify(consolidated, null, 2));
  console.log(`Wrote ${consolidated.length} items to mqss_projects_items.json`);
})();