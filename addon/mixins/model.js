import Ember from 'ember';
import DS from 'ember-data';
import {
  queryParamPropertyName,
  lastWasErrorPropertyName,
  ajaxOptionsPropertyName,
  stickyPropertyName
} from '../property-names';
import {recordHasId} from '../belongs-to-sticky';

/**
 * Mixin for DS.Model extensions.
 */
export default Ember.Mixin.create({
  /**
   * Query a HasMany/BelongsTo relationship link.
   *
   * If you do something like this:
   * ```javascript
   * post.query('comments', { page: 1 });
   * ```
   *
   * The call made to the server will look something like this:
   * ```
   * Started GET "/api/v1/post/1/comments?page=1"
   * ```
   *
   * @param {String} propertyName Relationship property name
   * @param {Object} params Query parameters
   * @returns {Ember.RSVP.Promise}
   */
  query: function (propertyName, params) {
    var self = this;

    //set the query params as a property on this record
    var _queryParamPropertyName = queryParamPropertyName(propertyName);
    this.set(_queryParamPropertyName, params);

    //abort the last query request for this property
    var _ajaxOptionsPropertyName = ajaxOptionsPropertyName(propertyName);
    var lastAjaxOptions = this.get(_ajaxOptionsPropertyName);
    if (lastAjaxOptions && lastAjaxOptions.jqXHR) {
      lastAjaxOptions.jqXHR.abort();
    }

    //get the relationship value, reloading if necessary
    var value = this.reloadRelationship(propertyName);

    //return the promise, clearing the query params and ajax options properties
    return value.catch(function (error) {
      if (error instanceof DS.AbortError) {
        //ignore aborted requests
        return;
      }
      throw error;
    }).finally(function () {
      self.set(_queryParamPropertyName, undefined);
      self.set(_ajaxOptionsPropertyName, undefined);
    });
  },

  /**
   * Get the relationship property for the given property name, reloading the async relationship if necessary.
   *
   * @param propertyName Relationship property name
   * @returns {Ember.RSVP.Promise}
   */
  reloadRelationship: function (propertyName) {
    //find out what kind of relationship this is
    var relationshipsByName = this.get('constructor.relationshipsByName');
    var relationship = relationshipsByName && relationshipsByName.get(propertyName);
    var isHasMany = relationship && relationship.kind === 'hasMany';

    var self = this;
    var reference = isHasMany ? this.hasMany(propertyName) : this.belongsTo(propertyName);
    return new Ember.RSVP.Promise(function (resolve) {
      //run.next, so that aborted promise gets rejected before starting another
      Ember.run.next(this, function () {
        var isLoaded = reference.value() !== null;
        if (isLoaded) {
          resolve(reference.reload());
        } else {
          //isLoaded is false when the last query resulted in an error, so if this load
          //results in an error again, reload the reference to query the server again
          var promise = reference.load().catch(function (error) {
            var _lastWasErrorPropertyName = lastWasErrorPropertyName(propertyName);
            if (self.get(_lastWasErrorPropertyName)) {
              //last access to this property resulted in an error, so reload
              return reference.reload();
            }
            //mark this result as an error for next time the property is queried
            self.set(_lastWasErrorPropertyName, true);
            throw error;
          });
          resolve(promise);
        }
      });
    });
  },

  notifyBelongsToChanged: function (key) {
    //called when a belongsTo property changes
    this._super(...arguments);

    //if a belongsTo relationship attribute has changed, and the new record has an id,
    //store the record in a property so that the belongsToSticky can return if it required
    var value = this.get(key);
    if (recordHasId(value)) {
      var meta = this.constructor.metaForProperty(key);
      if (meta.sticky) {
        this.set(stickyPropertyName(key), value);
      }
    }
  }
});
