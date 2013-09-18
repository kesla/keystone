var keystone = require('../../'),
	_ = require('underscore'),
	async = require('async'),
	cloudinary = require('cloudinary'),
	moment = require('moment'),
	utils = require('../../lib/utils');

exports = module.exports = function(req, res) {
	
	req.list.model.findById(req.params.item).exec(function(err, item) {
		
		if (Array.isArray(item))
			item = item[0]; // WTF??? I thought findById was only meant to return a single document.
		
		if (!item) {
			req.flash('error', 'Item ' + req.params.item + ' could not be found.');
			return res.redirect('/keystone/' + req.list.path);
		}
		
		var viewLocals = {
			validationErrors: {}
		};
		
		var renderView = function() {
			
			var relationships = _.values(_.map(req.list.relationships, function(i) { return _.clone(i); }));
			
			var drilldown = {
				def: req.list.get('drilldown'),
				data: {},
				items: []
			};
			
			var loadDrilldown = function(cb) {
				
				if (!drilldown.def)
					return cb();
				
				// step back through the drilldown list and load in reverse order to support nested relationships
				// TODO: proper support for nested relationships in drilldown
				drilldown.def = drilldown.def.split(' ').reverse();
				
				async.eachSeries(drilldown.def, function(path, done) {
					
					var field = req.list.fields[path];
					
					if (!field || field.type != 'relationship')
						throw new Error('Drilldown for ' + req.list.key + ' is invalid: field at path ' + path + ' is not a relationship.');
					
					var refList = field.refList;
					
					if (field.many) {
						if (!item.get(field.path).length) {
							return done();
						}
						refList.model.find().where('_id').in(item.get(field.path)).limit(4).exec(function(err, results) {
							if (err || !results) {
								done(err);
							}
							var more = (results.length == 4) ? results.pop() : false;
							if (results.length) {
								drilldown.data[path] = results;
								drilldown.items.push({
									list: refList,
									items: _.map(results, function(i) { return {
										label: refList.getDocumentName(i),
										href: '/keystone/' + refList.path + '/' + i.id
									}}),
									more: (more) ? true : false
								});
							}
							done();
						});
					} else {
						if (!item.get(field.path)) {
							return done();
						}
						refList.model.findById(item.get(field.path)).exec(function(err, result) {
							if (result) {
								drilldown.data[path] = result;
								drilldown.items.push({
									list: refList,
									label: refList.getDocumentName(result),
									href: '/keystone/' + refList.path + '/' + result.id
								});
							}
							done();
						});
					}
					
				}, function(err) {
					// put the drilldown list back in the right order
					drilldown.def.reverse();
					drilldown.items.reverse();
					cb(err);
				});
			}
			
			var loadRelationships = function(cb) {
				
				async.each(relationships, function(rel, done) {
					
					// TODO: Handle invalid relationship config
					rel.list = keystone.list(rel.ref);
					rel.sortable = (rel.list.get('sortable') && rel.list.get('sortContext') == req.list.key + ':' + rel.path);
					
					// TODO: Handle relationships with more than 1 page of results
					var q = rel.list.paginate({ page: 1, perPage: 100 })
						.where(rel.refPath).equals(item.id)
						.sort(rel.list.defaultSort);
						
					// rel.columns = _.reject(rel.list.defaultColumns, function(col) { return (col.type == 'relationship' && col.refList == req.list) });
					rel.columns = rel.list.defaultColumns
					rel.list.selectColumns(q, rel.columns);
					
					q.exec(function(err, results) {
						rel.items = results;
						done(err);
					});
					
				}, cb);
			}
			
			/** Render View */
			
			async.parallel([
				loadDrilldown,
				loadRelationships
			], function(err) {
				
				var showRelationships = _.some(relationships, function(rel) {
					return rel.items.results.length;
				});
				
				keystone.render(req, res, 'item', _.extend(viewLocals, {
					section: keystone.nav.by.list[req.list.key] || {},
					title: 'Keystone: ' + req.list.singular + ': ' + req.list.getDocumentName(item),
					list: req.list,
					item: item,
					relationships: relationships,
					showRelationships: showRelationships,
					drilldown: drilldown
				}));
				
			});
			
		}
		
		if (req.method == 'POST' && req.body.action == 'updateItem' && !req.list.get('noedit')) {
			
			item.getUpdateHandler(req).process(req.body, { flashErrors: true }, function(err) {
				if (err) {
					return renderView();
				}
				req.flash('success', 'Your changes have been saved.');
				return res.redirect('/keystone/' + req.list.path + '/' + item.id);
			});
			
			
		} else {
			renderView();
		}
		
	});
	
}