# Pigallery2 user rights

The following users are supported in the app with these rights:

| id | Role          | rights                                  | who has it |
|----|---------------|-----------------------------------------|------------|
| 1  | Limited Guest | listing directory                       | using shared link |
| 2  | Guest         | + search                                | no one (you can set manually in the db, if necessary) |
| 3  | User          | + share, list faces, create random link | default role |
| 4  | Admin         | + settings, see duplicate photos        | default (pregenerated) user (also the default right if authentication is off) |
| 5  | Developer     | + see errors                            | no one (you can set manually in the db, if necessary) |

**Note:** If you would like to set a user rights and does not work with the role name (string) use its id.


Admins can create accounts and assign roles up to their own role. Managing a higher-role account requires a user with at least that role. These limits also apply to role grants through configuration.

Listing albums requires at least the User role and the configured Albums listing right. Restart the server after changing this setting. Creating and deleting albums requires Admin.
