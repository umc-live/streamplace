
import Resource from "sp-resource";

export default class Output extends Resource {
  auth(ctx, doc) {
    return Promise.resolve();
  }

  authQuery(ctx, query) {
    return Promise.resolve({});
  }
}

Output.tableName = "outputs";
