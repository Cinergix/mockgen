#!/usr/bin/env node

import * as path from 'path';
import { statSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import AST from 'ts-simple-ast';
import {
    SourceFile,
    ClassDeclaration,
    MethodDeclaration,
    ConstructorDeclaration,
    Scope,
    PropertyDeclaration,
    GetAccessorDeclaration,
    SetAccessorDeclaration,
    ParameterDeclaration,
} from 'ts-simple-ast';

const ast = new AST();
const tab = '    ';
const mockClassFilenameSuffix = '.mock.ts';

ast.addSourceFiles('./src/**/*.ts');
ast.getSourceFiles().forEach(sourceFile => {
    const sourceClasses = sourceFile.getClasses();

    if (!sourceClasses.length) {
        return;
    }

    const rootPath = process.cwd().replace( /\\/g, '/' );
    const sourcePath = sourceFile.getFilePath();

    const outputPath = sourcePath.replace(rootPath + '/src', rootPath + '/test').replace(/\.ts$/, mockClassFilenameSuffix);
    const outputDirname = path.dirname(outputPath);
    const relativePath = path.relative(outputDirname, sourcePath).replace( /\\/g, '/' );

    const allUserMethods = getUserWrittenCodeFromMockFile( outputPath );

    const mockedImports = sourceClasses
        .map(sourceClass => {
            return `import { ${sourceClass.getName()} } from '${relativePath.replace(/\.ts$/, '')}';`
        });

    const mockedClasses = sourceClasses
        .map(sourceClass => {
            return [
                ...createClassHeader( sourceClass ),
                ...prefix(tab, createHelpers( sourceClass )),
                ...prefix(tab, createMembers( sourceClass )),
                ...applyUserMethods( 'Mock'+sourceClass.getName(), allUserMethods ),
                ...createClassFooter(sourceClass),
            ];
        })
        .reduce((acc: string[], next: string[]) => {
            return acc.concat(next);
        }, []);

    const mockedSource = [
        '// tslint:disable',
        '',
        ...mockedImports,
        '',
        ...mockedClasses,
        '',
    ].join('\n');

    try {
        statSync(outputDirname);
    } catch (err) {
        mkdirSync(outputDirname);
    }

    writeFileSync(outputPath, mockedSource);

});

function prefix(str: string, lines: string[]): string[] {
    return lines.map(line => line !== '' ? str + line : '');
}

function upperCamelCase(str: string): string {
    return str[0].toUpperCase() + str.slice(1);
}

function createTypeParams(sourceClass: ClassDeclaration) {
    const params = sourceClass.getTypeParameters().map(() => 'any');
    if (!params.length) {
        return '';
    }
    return `<${params.join(',')}>`;
}

function createClassHeader(sourceClass: ClassDeclaration): string[] {
    const className = sourceClass.getName();
    const typeParams = createTypeParams(sourceClass);
    return [`export class Mock${className} extends ${className}${typeParams} {`];
}

function createClassFooter(sourceClass: ClassDeclaration): string[] {
    return [`}`];
}

function createHelpers(sourceClass: ClassDeclaration): string[] {
    const className = sourceClass.getName();
    return [
        `/**`,
        ` * Static Helpers`,
        ` */`,
        ``,
        `private static \$spies: any = {};`,
        `private static get \$class(): any {`,
        `${tab}return ${className};`,
        `}`,
        `public static \$get( field: string ): any {`,
        `${tab}return this.\$class[field];`,
        `}`,
        `public static \$call( field: string, ...args: any[]): any {`,
        `${tab}return this.\$class[field].call( this, ...args );`,
        `}`,
        `public static \$createGetterFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOnProperty( this.\$class, field, 'get' );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
        `public static \$createSetterFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOnProperty( this.\$class, field, 'set' );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
        `public static \$createSpyFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOn( this.\$class, field );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
        ``,
        `/**`,
        ` * Instance Helpers`,
        ` */`,
        ``,
        `private \$spies: any = {};`,
        `private get \$instance(): any {`,
        `${tab}return this;`,
        `}`,
        `private get \$prototype(): any {`,
        `${tab}return ${className}.prototype;`,
        `}`,
        `public \$get( field: string ): any {`,
        `${tab}return this.\$instance[field];`,
        `}`,
        `public \$call( field: string, ...args: any[]): any {`,
        `${tab}return this.\$prototype[field].call( this, ...args );`,
        `}`,
        `public \$createGetterFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOnProperty( this.\$instance, field, 'get' );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
        `public \$createSetterFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOnProperty( this.\$instance, field, 'set' );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
        `public \$createSpyFor( field: string ): jasmine.Spy {`,
        `${tab}if ( !this.\$spies[field]) {`,
        `${tab}${tab}this.\$spies[field] = spyOn( this.\$instance, field );`,
        `${tab}}`,
        `${tab}return this.\$spies[field];`,
        `}`,
    ];
}

function createMethod(sourceProperty: MethodDeclaration): string[] {
    const lines = [''];
    const propertyName = sourceProperty.getName();
    lines.push(
        `/**`,
        ` * ${propertyName}`,
        ` */`,
    );
    if (sourceProperty.getStaticKeyword()) {
        if (sourceProperty.getScope() === Scope.Protected || sourceProperty.getScope() === Scope.Private) {
            lines.push(
                `public static \$call${upperCamelCase(propertyName)}( ...args: any[]) {`,
                `${tab}return this.$call( '${propertyName}', ...args );`,
                `}`,
            );
        }
        lines.push(
            `public static \$createSpyFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createSpyFor( '${propertyName}' );`,
            `}`,
        );
    } else {
        if (sourceProperty.getAbstractKeyword()) {
            lines.push(
                `public ${propertyName}( ...args: any[]) {`,
                `${tab}return undefined as any;`,
                `}`,
            );
        } else if (sourceProperty instanceof MethodDeclaration && sourceProperty.getScope() === Scope.Protected ) {
            lines.push(
                `public ${propertyName}( ...args: any[]) {`,
                `${tab}return this.$call( '${propertyName}', ...args );`,
                `}`,
            );
        } else if (sourceProperty instanceof MethodDeclaration && sourceProperty.getScope() === Scope.Private ) {
            lines.push(
                `public \$call${upperCamelCase(propertyName)}( ...args: any[]) {`,
                `${tab}return this.$call( '${propertyName}', ...args );`,
                `}`,
            );
        }
        lines.push(
            `public \$createSpyFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createSpyFor( '${propertyName}' );`,
            `}`,
        );
    }
    return lines;
}

function createGetter(sourceProperty: PropertyDeclaration | GetAccessorDeclaration): string[] {
    const lines = [''];
    const propertyName = sourceProperty.getName();
    lines.push(
        `/**`,
        ` * ${propertyName}`,
        ` */`,
    );
    if (sourceProperty.getStaticKeyword()) {
        if (sourceProperty.getScope() === Scope.Private || sourceProperty.getScope() === Scope.Protected) {
            lines.push(
                `public static \$get${upperCamelCase(propertyName)}() {`,
                `${tab}return this.$get( '${propertyName}' );`,
                `}`,
            );
        }
        lines.push(
            `public static \$createGetterFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createGetterFor( '${propertyName}' );`,
            `}`,
        );
    } else {
        if (sourceProperty.getAbstractKeyword()) {
            if (sourceProperty instanceof PropertyDeclaration) {
                lines.push(`public ${propertyName}: any;`);
            }
            if (sourceProperty instanceof GetAccessorDeclaration) {
                lines.push(
                    `public get ${propertyName}(): any {`,
                    `${tab}return undefined as any;`,
                    `}`,
                );
            }
        } else if (sourceProperty.getScope() === Scope.Private || sourceProperty.getScope() === Scope.Protected) {
            lines.push(
                `public \$get${upperCamelCase(propertyName)}() {`,
                `${tab}return this.$get( '${propertyName}' );`,
                `}`,
            );
        }
        lines.push(
            `public \$createGetterFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createGetterFor( '${propertyName}' );`,
            `}`,
        );
    }
    return lines;
}

function createSetter(sourceProperty: SetAccessorDeclaration): string[] {
    const lines = [''];
    const propertyName = sourceProperty.getName();
    lines.push(
        `/**`,
        ` * ${propertyName}`,
        ` */`,
    );
    if (sourceProperty.getStaticKeyword()) {
        lines.push(
            `public static \$createSetterFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createSetterFor( '${propertyName}' );`,
            `}`,
        );
    } else {
        if (sourceProperty.getAbstractKeyword()) {
            lines.push(
                `public set ${propertyName}( val: any ) {`,
                `}`,
            );
        }
        lines.push(
            `public \$createSetterFor${upperCamelCase(propertyName)}() {`,
            `${tab}return this.\$createSetterFor( '${propertyName}' );`,
            `}`,
        );
    }
    return lines;
}

function createParameter(sourceProperty: ParameterDeclaration): string[] {
    const lines = [''];
    const parameterName = sourceProperty.getName();
    lines.push(
        `/**`,
        ` * ${parameterName}`,
        ` */`,
    );
    if (parameterName) {
        if (sourceProperty.getScope() === Scope.Private || sourceProperty.getScope() === Scope.Protected) {
            lines.push(
                `public \$get${upperCamelCase(parameterName)}() {`,
                `${tab}return this.$get( '${parameterName}' );`,
                `}`,
            );
        }
        lines.push(
            `public \$createGetterFor${upperCamelCase(parameterName)}() {`,
            `${tab}return this.\$createGetterFor( '${parameterName}' );`,
            `}`,
        );
    }
    return lines;
}

function createMembers(sourceClass: ClassDeclaration): string[] {
    return sourceClass.getAllMembers()
        .map(sourceProperty => {
            if (sourceProperty instanceof MethodDeclaration) {
                return createMethod(sourceProperty);
            } else if (sourceProperty instanceof PropertyDeclaration || sourceProperty instanceof GetAccessorDeclaration) {
                return createGetter(sourceProperty);
            } else if (sourceProperty instanceof SetAccessorDeclaration) {
                return createSetter(sourceProperty);
            } else if (sourceProperty instanceof ParameterDeclaration) {
                return createParameter(sourceProperty);
            } else {
                return [];
            }
        })
        .reduce((acc: string[], next: string[]) => {
            return acc.concat(next);
        }, []);
}

function applyUserMethods( sourceClassName: string, userMethods: { [className: string]: string } | undefined ) {
    let relevantUserMethods = [ `${tab}// ts-mockgen:user-methods-start`, '' ];
    if ( sourceClassName && userMethods && userMethods[sourceClassName] ) {
        relevantUserMethods.push( userMethods[sourceClassName] );
    } else {
        relevantUserMethods.push( `${tab}// Write your methods inside these markers` );
    }
    relevantUserMethods.push( '', `${tab}// ts-mockgen:user-methods-end` );
    return relevantUserMethods;
}

function getUserWrittenCodeFromMockFile( filepath: string ) {
    if (!existsSync( filepath )) {
         return undefined;
    }
    
    let userMethods: { [className: string]: string } = {};
    let currentClass: string | undefined = undefined;
    let saveLine: boolean = false;
    let linesToSave: string[] = [];

    const fileBuffer = readFileSync( filepath, 'utf8' );
    if ( fileBuffer ) {
        fileBuffer.toString().split('\n').forEach( line => { 
            if ( line ) {
                if ( line.search( /( class[ ])[a-zA-Z ]+/g ) > -1 ) {
                    const arr = line.match(/(class[ ])[a-zA-Z]+/g);
                    currentClass = arr ? arr[0].split(' ').pop() : undefined;
                }
                if ( currentClass ) {
                    if ( line && line.search( /(\/\/ ts-mockgen:user-methods-end)/g ) > -1 ) {
                        saveLine = false;
                        userMethods[ currentClass ] = linesToSave.join('\n');
                        linesToSave = [];
                        currentClass = '';
                    }
                    if (saveLine) {
                        linesToSave.push( line );
                    } 
                    if ( line && line.search( /(\/\/ ts-mockgen:user-methods-start)/g ) > -1 ) {
                        saveLine = true;
                    }
                } 
            }
        });
    }

    return userMethods;
}