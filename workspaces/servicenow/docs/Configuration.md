# Configuration

This document describes the configuration for the ServiceNow backend plugin.

## ServiceNow Authentication

To use the ServiceNow backend plugin, you need to configure it in your `app-config.yaml` file.

The plugin supports both Basic Authentication and OAuth with grant types "password" and "client_credentials".

### Basic Authentication

You can use basic authentication with your ServiceNow admin username and password.

```yaml
servicenow:
  instanceUrl: https://<your-dev-instance>.service-now.com
  basicAuth:
    username: admin
    password: <your-password>
```

### OAuth 2.0 Authentication

The plugin supports two OAuth grant types: `password` and `client_credentials`.

#### Grant Type "password"

This grant type requires your admin username, password, client ID, and client secret.

1.  **Create an OAuth configuration in ServiceNow:**

    - In the ServiceNow UI, navigate to **All** -> **Application registry**.
    - Click **New** and select **Create an OAuth API endpoint for external clients**.
    - Fill in the form:
      - **Name:** `oauth` (or any desired name)
      - **Client Secret:** `mysecret` (or any desired value)
      - **Client Type:** Integration as a User (in the dropdown)
    - Copy the **Client ID** and submit the form.

2.  **Update your `app-config.yaml`:**

    ```yaml
    servicenow:
      instanceUrl: https://<your-dev-instance>.service-now.com
      oauth:
        grantType: password
        clientId: <your-client-id>
        clientSecret: <your-client-secret>
        username: admin
        password: <your-admin-password>
    ```

#### Grant Type "client_credentials"

This grant type allows authentication using only a client ID and client secret, without an admin password in the configuration. Read more https://www.servicenow.com/community/developer-blog/up-your-oauth2-0-game-inbound-client-credentials-with-washington/ba-p/2816891

2.  **Enable the necessary system properties:**

    Create new property `glide.oauth.inbound.client.credential.grant_type.enabled`. Navigate to `https://<your-instance-url>/sys_properties_list.do`,
    and search `glide.oauth.inbound.client.credential.grant_type.enabled`. If it is not present, click "New" button.
    In the "System Property" form provide:

    - Name: glide.oauth.inbound.client.credential.grant_type.enabled
    - Type: "true|false"
    - Value: "true"

    Click "Save".

1.  **Create an OAuth configuration in ServiceNow:**

    - In the ServiceNow UI, navigate to **All** -> **Application registry**.
    - Click **New** and select **Create an OAuth API endpoint for external clients**.
    - Fill in the form:

      - **Name:** `oauth` (or any desired name)
      - **Client Secret:** `mysecret` (or any desired value)
      - **Client Type:** Integration as a Service (in the dropdown)
      - Assign an admin user to the OAuth configuration. But by default UI hide this option, so you need to use "Form builder" to put this option onto UI.

      Notice: if you don't want to use "Form builder" you can use corresponding Glide script:

      ```js
      var clientId = 'your-created-oauth-configuration-client-id';
      var userName = 'admin'; // your admin username

      // Find OAuth client by client_id
      var clientGR = new GlideRecord('<your-client-id>');
      clientGR.addQuery('client_id', clientId);
      clientGR.query();

      if (clientGR.next()) {
        var userGR = new GlideRecord('sys_user');
        userGR.addQuery('user_name', userName);
        userGR.query();

        if (userGR.next()) {
          clientGR.setValue('user', userGR.sys_id);
          clientGR.update();
          gs.info('✅ Integration user was set up: ' + userGR.user_name);
        } else {
          gs.error('❌ User with user_name was not found: ' + userName);
        }
      } else {
        gs.error('❌ OAuth client with client_id was not found: ' + clientId);
      }
      ```

1.  **Update your `app-config.yaml`:**

    ```yaml
    servicenow:
      instanceUrl: https://<your-dev-instance>.service-now.com
      oauth:
        grantType: client_credentials
        clientId: <your-client-id>
        clientSecret: <your-client-secret>
    ```

## Global Incident Filter

The ServiceNow plugin supports a global filter configuration that applies to **all** incident queries across your Backstage instance. This feature allows administrators to enforce organization-wide filtering rules at the application level, ensuring consistent incident visibility policies.

### Use Cases

- **Security**: Exclude sensitive incidents from general visibility
- **Data Quality**: Filter out test or demo incidents
- **Compliance**: Enforce organizational policies on incident visibility
- **Performance**: Reduce query load by filtering out irrelevant incidents
- **Organization**: Show only incidents relevant to your organization's scope

The global filter is configured in `app-config.yaml` under `servicenow.incidentFilter` and uses a flexible structure that supports:

- **Rules**: Individual field conditions with various operators
- **Groups**: Logical groupings of rules and nested groups (AND/OR)
- **Negation**: Ability to negate individual rules or entire groups
- **Nested Logic**: Complex multi-level filtering with unlimited nesting depth

### Filter Structure

The filter configuration follows this structure:

```yaml
servicenow:
  instanceUrl: https://<your-instance>.service-now.com
  # ... authentication config ...
  incidentFilter:
    type: 'and' | 'or'  # Logical operator for combining rules/groups
    rules?:             # List of individual filter rules
      - field: string           # Field name in ServiceNow incident table
        value: string | number | boolean  # Value to compare against
        operator?: string       # Comparison operator (default: '=')
        negate?: boolean        # Negate this rule (default: false)
    groups?:            # List of nested filter groups
      - type: 'and' | 'or'
        rules?: [...]
        groups?: [...]
        negate?: boolean
    negate?: boolean     # Negate the entire group (default: false)
```

### Supported Operators

The following operators are supported for filter rules:

| Operator     | Description                | Example                            |
| ------------ | -------------------------- | ---------------------------------- |
| `=`          | Equals                     | `state=2`                          |
| `!=`         | Not equals                 | `state!=1`                         |
| `>`          | Greater than               | `priority>3`                       |
| `<`          | Less than                  | `priority<5`                       |
| `>=`         | Greater than or equal      | `priority>=2`                      |
| `<=`         | Less than or equal         | `priority<=4`                      |
| `STARTSWITH` | Starts with (text search)  | `short_descriptionSTARTSWITHEMAIL` |
| `ENDSWITH`   | Ends with (text search)    | `numberENDSWITH123`                |
| `CONTAINS`   | Contains (text search)     | `descriptionCONTAINSWatcher`       |
| `LIKE`       | Like pattern (text search) | `short_descriptionLIKEtest value`  |
| `IN`         | In list                    | `stateIN1,2,3`                     |

**Note**: Text operators (`LIKE`, `STARTSWITH`, `ENDSWITH`, `CONTAINS`) do not URL-encode values, allowing spaces and special characters to work correctly with ServiceNow's text search functionality.

### Basic Examples

#### Example 1: Filter by State

Exclude incidents in state 1 (New) and only show incidents in state 2 (In Progress) or higher:

```yaml
servicenow:
  instanceUrl: https://<your-instance>.service-now.com
  basicAuth:
    username: admin
    password: <your-password>
  incidentFilter:
    type: 'and'
    rules:
      - field: state
        operator: '>'
        value: 1
```

#### Example 2: Filter by Priority Range

Show only high and critical priority incidents:

```yaml
servicenow:
  incidentFilter:
    type: 'or'
    rules:
      - field: priority
        value: '1' # Critical
      - field: priority
        value: '2' # High
```

#### Example 3: Exclude Specific States

Exclude incidents in states 1 (New) and 7 (Closed Cancelled):

```yaml
servicenow:
  incidentFilter:
    type: 'and'
    rules:
      - field: state
        operator: '!='
        value: '1'
      - field: state
        operator: '!='
        value: '7'
```

### Advanced Examples

#### Example 4: Complex Logic with Groups

Filter incidents that are either:

- In state 2 (In Progress) OR state 3 (On Hold)
- AND NOT in priority 1 (Critical) OR priority 2 (High)

```yaml
servicenow:
  incidentFilter:
    type: 'and'
    groups:
      - type: 'or'
        rules:
          - field: state
            operator: '='
            value: '2'
          - field: state
            operator: '='
            value: '3'
      - type: 'and'
        negate: true
        groups:
          - type: 'or'
            rules:
              - field: priority
                value: '1'
              - field: priority
                value: '2'
```

This generates a query equivalent to: `(state=2 OR state=3) AND NOT (priority=1 OR priority=2)`

#### Example 5: Text Search with LIKE

Filter incidents where the short description starts with "EMAIL" or contains "Watcher":

```yaml
servicenow:
  incidentFilter:
    type: 'or'
    rules:
      - field: short_description
        operator: 'STARTSWITH'
        value: 'EMAIL'
      - field: description
        operator: 'CONTAINS'
        value: 'Watcher'
```

#### Example 6: Negated Rules

Show incidents where state is NOT 1, using negate on the rule:

```yaml
servicenow:
  incidentFilter:
    type: 'and'
    rules:
      - field: state
        operator: '='
        value: '1'
        negate: true
```

This is equivalent to `state!=1`.

#### Example 7: Mixed Rules and Groups

Combine individual rules with nested groups:

```yaml
servicenow:
  incidentFilter:
    type: 'and'
    rules:
      - field: state
        operator: '>'
        value: '1'
    groups:
      - type: 'or'
        rules:
          - field: priority
            value: '1'
          - field: priority
            value: '2'
```

This filters for incidents where `state > 1 AND (priority=1 OR priority=2)`.

### How It Works

1. **Global Application**: The filter is applied to **all** incident queries made through the plugin, regardless of user-specific filters, entity annotations, or search terms. This ensures consistent filtering across all users and entities.

2. **Query Combination**: The global filter is combined with other query parameters (user email, entity annotations, search terms, pagination) using AND logic. This means incidents must satisfy **both** the global filter **and** any user-specific filters to be displayed.

3. **ServiceNow Encoded Query**: The filter configuration is automatically converted to ServiceNow's encoded query format (e.g., `state>1^priority=2^ORpriority=3`) and appended to the query string sent to ServiceNow's API.

4. **Negation**:

   - **Rule-level negation** (`negate: true` on a rule) generates `!field=value` in the query
   - **Group-level negation** (`negate: true` on a group) uses ServiceNow's `^NQ` (NOT query) operator to negate entire logical groups

5. **Execution Order**: The filter is evaluated server-side before results are returned to the client, ensuring consistent behavior across all users.

### Best Practices

1. **Performance**: Keep filters simple and use indexed fields (like `state`, `priority`) when possible for better query performance.

2. **Testing**: Test your filter configuration in ServiceNow's query builder first to ensure it works as expected before adding it to `app-config.yaml`.

3. **Documentation**: Document your filter logic in comments or team documentation, especially for complex nested groups.

4. **Incremental Changes**: Start with simple filters and gradually add complexity as needed.

### Important Notes

1. **Filter Persistence**: The global filter is applied to every incident query, including:

   - Entity-specific incident queries (filtered by annotations)
   - User-specific incident queries (filtered by user email)
   - Search queries
   - All pagination requests

2. **Field Validation**: The plugin validates that filter fields exist in your ServiceNow schema, but it does not validate field values. Ensure your filter values match the expected data types in ServiceNow.

3. **Performance Impact**: Complex filters with many nested groups may impact query performance. Test your filter configuration with realistic data volumes.

4. **Text Operators**: Operators `LIKE`, `STARTSWITH`, `ENDSWITH`, and `CONTAINS` do not URL-encode values, allowing spaces and special characters to work correctly with ServiceNow's text search. Other operators automatically URL-encode values.

### Troubleshooting

- **No incidents showing**:

  - Check if your global filter is too restrictive
  - Verify that incidents exist in ServiceNow that match your filter criteria
  - Try temporarily removing the filter to see if incidents appear
  - Test your filter logic directly in ServiceNow's query builder

- **Unexpected results**:

  - Verify your filter logic matches ServiceNow's query syntax
  - Check that field names match exactly (case-sensitive)
  - Ensure values match the expected data types (string, number, boolean)
  - Test queries directly in ServiceNow's UI using the generated encoded query format

- **Special characters**:

  - Text operators (`LIKE`, `STARTSWITH`, `ENDSWITH`, `CONTAINS`) handle spaces and special characters automatically
  - For other operators, values are automatically URL-encoded
  - If you need to search for special characters with text operators, use them directly in the value

- **Filter not applying**:
  - Verify the YAML syntax is correct (proper indentation, quotes where needed)
  - Check backend logs for configuration errors
  - Ensure the `incidentFilter` key is under `servicenow` in your `app-config.yaml`
