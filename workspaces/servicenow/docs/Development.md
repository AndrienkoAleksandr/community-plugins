# Development

## Prerequisites

You need a ServiceNow Personal Developer Instance (PDI). Request one from the [ServiceNow Developer Site](https://developer.servicenow.com/dev.do): sign in, then click **Request Instance** in the header and pick a release. Instance URL and admin password are on **Manage my Instance**.

The plugin uses **two different identities**. Do not treat them as the same user.

| Role                | Who                                  | Used for                                                                             |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Integration account | `SERVICENOW_USERNAME` / OAuth client | Backend Table API calls. Use the PDI **admin**. Its email is not used for filtering. |
| Ticket-owner email  | Harness guest `guest@example.com`    | `userEmail` filter on `/servicenow-user`. Many PDIs already have this `sys_user`.    |

`yarn start` does not start a full Backstage portal. There is no Software Catalog UI here, so URLs like `/catalog/default/component/example-website` will not work. Use the plugin pages listed under [Start the harnesses](#start-the-harnesses).

### Integration account (Table API)

A personal developer instance already includes **admin**. Use that account as `SERVICENOW_USERNAME` / `SERVICENOW_PASSWORD` (and as the OAuth password-grant user). Do not put the ticket-owner person’s credentials here.

If Table API Basic auth returns `User is not authenticated`, the instance is not accepting Basic auth — use OAuth as in [Configuration.md](./Configuration.md) and [backend CONTRIBUTING.md](../plugins/servicenow-backend/CONTRIBUTING.md). Creating a user does not enable Basic auth by itself.

### Ticket-owner email (my tickets)

http://localhost:3000/servicenow-user shows the Backstage guest User. The plugin lists incidents for **`guest@example.com`** (`caller_id` / `opened_by` / `assigned_to`). Your own email (Gmail, work, etc.) is not used: the live UI sends the email from the guest fixture, not from `examples/org.yaml`.

In a full Backstage app (GitHub/OIDC login) `userEmail` is the signed-in person’s email. That is a different setup.

**All → User Administration → Users** and search User ID `guest`.

If the user **exists** (typical on a PDI):

1. Open it and confirm **Email** is `guest@example.com` (set it if empty or different, then **Update**).
2. ServiceNow never shows the current password. Click **Set Password**, generate a password, copy it, and save. You need this only to sign in to the ServiceNow UI as `guest` and create a ticket.
3. On the **Roles** related list add `itil` if it is missing, so they can create incidents in the UI.

If the user **does not exist**:

1. **Users → New**.
2. Set **User ID** `guest`, **Email** `guest@example.com`, then **Submit**.
3. Open the user, **Set Password**, generate and save a password.
4. Add role `itil`.

Demo incidents are not guaranteed to belong to `guest`. Sign in to the ServiceNow UI as `guest` (the password you just generated) and create at least one incident, or as admin set that person as **Caller**, **Opened by**, or **Assigned to**. Then refresh `/servicenow-user`.

Do not use this person’s User ID as `SERVICENOW_USERNAME`. The backend still authenticates as admin; the plugin matches tickets by email.

## Local testing

```
yarn install
```

Configure ServiceNow credentials. See [`Configuration.md`](./Configuration.md) and [backend CONTRIBUTING.md](../plugins/servicenow-backend/CONTRIBUTING.md).

### Entity-id smoke (Component)

http://localhost:3000/servicenow shows the catalog Component `example-website`. The plugin lists ServiceNow incidents **for that component only**.

The example in [`examples/entities.yaml`](../examples/entities.yaml) uses the built-in annotation `servicenow.com/entity-id: website-for-my-nice-service`. That maps to the ServiceNow incident column **`u_backstage_entity_id`**. A PDI incident table does **not** have this column until you add it, so the plugin cannot filter until the field exists and tickets have the same value.

This is one filter. You can instead (or also) use a custom annotation `servicenow.com/<field_name>` whose `<field_name>` already exists on incident (for example `servicenow.com/category` or `servicenow.com/u_service`). See [Annotations](./index.md#annotations).

For the built-in entity-id case, create `u_backstage_entity_id` under admin:

1. **All → System Definition → Tables → incident**.
2. Related list **Columns → New**.
3. Set: **Type:** String; **Column label:** `Backstage entity id`; **Column name** should be `u_backstage_entity_id` (`u_` is added if you omit it); **Max length** up to your choise.
4. Submit.

Creating the column does not put it on the incident form. Add it under admin:

1. Open any incident (**All → Incident → All**).
2. Click "Additional Actions" button → **Configure → Form Layout**.
3. In **Available**, find **Backstage entity id**, move it to **Selected**, then **Save**.

Then set **Backstage entity id** on the incidents you want to see to `website-for-my-nice-service`. Guest email is not required for this smoke.

### Start the harnesses

```
yarn start
```

- Entity-id: http://localhost:3000/example-website
- My tickets: http://localhost:3000/servicenow-user
