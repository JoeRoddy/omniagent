# Data Model: Custom Agents Directory Override

## Agents Directory Resolution

Represents a resolved directory used for agent configuration operations.

- **Fields**:
  - `requestedPath` (string | null): Raw override input from the user, if provided.
  - `resolvedPath` (string): Final directory used for reads/writes.
  - `source` (enum): `default`, `override`.
  - `isDefault` (boolean): True when using the default `agents/` directory.
  - `validationStatus` (enum): `valid`, `missing`, `notDirectory`, `permissionDenied`.
  - `errorMessage` (string | null): User-facing error details when invalid.

- **Relationships**:
  - Contains many **Agent Config Files**.

## Agent Config File

Represents a single agent configuration file located within the resolved directory.

- **Fields**:
  - `name` (string): Agent identifier derived from file path.
  - `path` (string): Full path to the config file.
  - `directoryPath` (string): Parent directory containing the config file.
  - `isWithinAgentsDir` (boolean): True when stored under the resolved agents directory.

- **Relationships**:
  - Belongs to one **Agents Directory Resolution**.
