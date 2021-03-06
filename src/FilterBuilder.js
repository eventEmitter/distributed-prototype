(function() {
    'use strict';



    const log = require('ee-log');



    module.exports = class FilterBuilder {


        constructor(parent, type) {
            this.type = type || 'root';
            this.children = [];
            this.parent = parent;
        }





        replace(newFilter) {
            const wasReplaced = this.parent.children.some((item, index) => {
                if (item === this) {
                    this.parent.children[index] = newFilter;
                    return true;
                }
            });

            if (!wasReplaced) throw new Error(`Failed to replace filter!`);
            return newFilter;
        }


        remove() {
            const wasRemoved = this.parent.children.some((item, index) => {
                if (item === this) {
                    this.parent.children.splice(index, 1);
                    return true;
                }
            });

            if (!wasRemoved) throw new Error(`Failed to remove filter!`);
            return this.parent;
        }






        and() {
            const builder = new FilterBuilder(this, 'and');
            this.addChild(builder);
            return builder;
        }

        or() {
            const builder = new FilterBuilder(this, 'or');
            this.addChild(builder);
            return builder;
        }

        getFirstNonEntityParentChild(scope) {
            if (scope.parent.type === 'entity') return this.getFirstNonEntityParentChild(scope.parent);
            else return scope;
        }





        comparator(comparator) {
            const builder = new FilterBuilder(this, 'comparator').setComparator(comparator);
            this.addChild(builder);
            return builder;
        }

        setComparator(comparator) {
            if (this.type !== 'comparator') throw new Error(`Cannot set comparator on node of the type ${this.type}!`);
            this.comparator = comparator;
            return this;
        }





        fn(functionName, parameters) {
            const builder = new FilterBuilder(this, 'function').setFunctionName(functionName).setParameters(parameters);
            this.addChild(builder);
            return builder;
        }

        setFunctionName(functionName) {
            if (this.type !== 'function') throw new Error(`Cannot set function on node of the type ${this.type}!`);
            this.functionName = functionName;
            return this;
        }

        setParameters(parameters) {
            if (this.type !== 'function') throw new Error(`Cannot set parameters on node of the type ${this.type}!`);
            if (Array.isArray(parameters)) parameters.forEach(value => this.value(value));
            else this.value(parameters);
            return this;
        }





        entity(name) {
            const builder = new FilterBuilder(this, 'entity').setEntityName(name);
            this.addChild(builder);
            return builder;
        }

        setEntityName(name) {
            if (this.type !== 'entity') throw new Error(`Cannot set entity on node of the type ${this.type}!`);
            this.entityName = name;
            return this;
        }




        property(name) {
            const builder = new FilterBuilder(this, 'property').setPropertyName(name);
            this.addChild(builder);
            return builder;
        }

        setPropertyName(name) {
            if (this.type !== 'property') throw new Error(`Cannot set property on node of the type ${this.type}!`);
            this.propertyName = name;
            return this;
        }





        value(value) {
            this.addChild(new FilterBuilder(this, 'value').setValue(value));
            return this;
        }

        setValue(value) {
            if (this.type !== 'value') throw new Error(`Cannot set value on node of the type ${this.type}!`);
            this.nodeValue = value;
            return this;
        }




        addChild(child) {
            if (child) this.children.push(child);
            return this;
        }




        get root() {
            if (this.parent) return this.parent.root;
            else return this;
        }



        getJSON() {
            const data =  {
                  type: this.type
                , children: this.children.map(child => child.getJSON())
            };

            // i wish i had thought this throug a bit earlier :/
            if (this.type === 'comparator')     data.comparator     = this.comparator;
            if (this.type === 'function')       data.functionName   = this.functionName;
            if (this.type === 'entity')         data.entityName     = this.entityName;
            if (this.type === 'property')       data.propertyName   = this.propertyName;
            if (this.type === 'value')          data.nodeValue      = this.nodeValue;

            return data;
        }


        toJSON() {
            return this.root.getJSON();
        }
    };
})();
